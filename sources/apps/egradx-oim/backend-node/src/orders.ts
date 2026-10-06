import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { egradxTransaction } from '@babulvaibhav/egradx-sdk';
import { Prisma, type Order, type OrderItem } from './generated/prisma/client.js';
import {
  accessDenied,
  bind,
  bindObject,
  caller,
  conflict,
  insufficientInventory,
  invalidRequest,
  invalidTransition,
  money,
  notFound,
  orderBy,
  page,
  pageable,
  plain,
  queryParam,
  route,
  rules,
  uuidParam,
  OimError,
  unreadableBody,
} from './http.js';
import { compareJavaUuids, type InventoryOperations } from './inventory.js';
import { AuditActions, Permissions, audit, organizationOf, type Oim } from './oim.js';
import { localDateTime, localNow } from './time.js';

const STATUSES = 'PENDING|CONFIRMED|PROCESSING|COMPLETED|CANCELLED';
const PROPERTIES = ['id', 'organizationId', 'customerId', 'status', 'totalAmount', 'notes', 'createdAt', 'updatedAt'];

type OrderWithItems = Order & { items: OrderItem[] };

/** As Java's OrderResponse and OrderItemResponse. */
export const orderResponse = (o: OrderWithItems) => ({
  id: o.id, customerId: o.customerId, status: o.status, totalAmount: money(o.totalAmount), notes: o.notes,
  createdAt: localDateTime(o.createdAt), updatedAt: localDateTime(o.updatedAt),
  items: o.items.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: money(i.unitPrice), totalPrice: money(i.totalPrice),
    warehouseId: i.warehouseId })),
});

/** The only moves an order may make. */
function validTransition(current: string, next: string): boolean {
  switch (current) {
    case 'PENDING': return next === 'CONFIRMED' || next === 'CANCELLED';
    case 'CONFIRMED': return next === 'PROCESSING' || next === 'CANCELLED';
    case 'PROCESSING': return next === 'COMPLETED';
    default: return false;
  }
}

const itemFields = {
  productId: { kind: 'uuid' as const, rules: [rules.notNull('Product ID is required')] },
  quantity: { kind: 'integer' as const, rules: [rules.notNull('Quantity is required'), rules.positive('Quantity must be positive')] },
  warehouseId: { kind: 'uuid' as const, rules: [rules.notNull('Warehouse ID is required')] },
};

/** /v1/orders, as Java's OrderController and OrderService. */
export function orderRoutes(oim: Oim, inventory: InventoryOperations): Router {
  const router = Router();
  const { prisma, auditor, dashboard } = oim;
  const inTx = <R>(fn: (tx: Prisma.TransactionClient) => Promise<R>) => egradxTransaction(prisma, (raw) => fn(raw as unknown as Prisma.TransactionClient));

  router.post('/v1/orders', route(async (request, response) => {
    caller();
    const body = bind(request, {
      customerId: { kind: 'uuid', rules: [rules.notNull('Customer ID is required')] },
      items: { kind: 'array', rules: [rules.notEmpty('Order items are required')] },
      notes: { kind: 'string', rules: [rules.maxLength(1000, 'Notes must not exceed 1000 characters')] },
    });
    // @Valid on the items: each is bound and checked as its own record.
    const items = (body.items as unknown[]).map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw unreadableBody();
      }
      return bindObject(raw as Record<string, unknown>, itemFields) as { productId: string; quantity: number; warehouseId: string };
    });
    const messages = items.flatMap((item) => Object.entries(itemFields).flatMap(([name, field]) => field.rules
      .map((rule) => rule(item[name as keyof typeof item])).filter((m): m is string => !!m)));
    if (messages.length) {
      throw invalidRequest(messages.join(', '));
    }
    const organizationId = organizationOf(caller(Permissions.ORDER_CREATE));
    response.json(await inTx(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: body.customerId as string, organizationId } });
      if (!customer) {
        throw notFound('Customer not found');
      }
      const products = new Map<string, { name: string; price: Prisma.Decimal; status: string }>();
      for (const productId of new Set(items.map((item) => item.productId))) {
        const product = await tx.product.findFirst({ where: { id: productId, organizationId } });
        if (!product) {
          throw notFound(`Product not found: ${productId}`);
        }
        products.set(productId, product);
      }
      const disabled = [...products.values()].find((product) => product.status === 'DISABLED');
      if (disabled) {
        throw conflict(`Product "${disabled.name}" is disabled and cannot be ordered`);
      }
      const lines: { inventoryId: string; item: (typeof items)[number] }[] = [];
      for (const item of items) {
        const stock = await tx.inventory.findFirst({ where: { organizationId, warehouseId: item.warehouseId, productId: item.productId } });
        if (!stock) {
          throw notFound('Inventory not found for warehouse and product');
        }
        lines.push({ inventoryId: stock.id, item });
      }
      // Reserved in one order (Java's UUID order), so concurrent orders can't deadlock.
      lines.sort((a, b) => compareJavaUuids(a.inventoryId, b.inventoryId));
      let total = new Prisma.Decimal(0);
      const orderItems: Omit<OrderItem, 'orderId'>[] = [];
      for (const { inventoryId, item } of lines) {
        try {
          await inventory.reserve(tx, organizationId, inventoryId, item.quantity);
        } catch (error) {
          if (error instanceof OimError && error.code === 'INSUFFICIENT_INVENTORY') {
            throw insufficientInventory(`INSUFFICIENT_INVENTORY for product: ${item.productId}`);
          }
          throw error;
        }
        const unitPrice = products.get(item.productId)!.price;
        const totalPrice = unitPrice.mul(item.quantity);
        orderItems.push({ id: randomUUID(), productId: item.productId, quantity: item.quantity, unitPrice, totalPrice, warehouseId: item.warehouseId });
        total = total.add(totalPrice);
      }
      const now = localNow();
      const saved = await tx.order.create({
        data: { id: randomUUID(), organizationId, customerId: customer.id, status: 'PENDING', totalAmount: total, notes: body.notes as string | null,
          createdAt: now, updatedAt: now, items: { create: orderItems } },
        include: { items: true },
      });
      // In reservation order, as the Java backend returns the order it just made.
      saved.items.sort((a, b) => orderItems.findIndex((i) => i.id === a.id) - orderItems.findIndex((i) => i.id === b.id));
      const result = orderResponse(saved);
      await auditor.record(audit(AuditActions.ORDER_CREATED).organization(organizationId).entity('order', saved.id).after(plain(result)).build());
      await inventory.notifications.orderCreated(organizationId, { id: saved.id, customerId: saved.customerId, status: saved.status,
        totalAmount: saved.totalAmount.toFixed(2), itemCount: saved.items.length });
      dashboard.evict(organizationId);
      return result;
    }));
  }));

  router.get('/v1/orders/:id', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const organizationId = organizationOf(caller(Permissions.ORDER_READ));
    const order = await prisma.order.findFirst({ where: { id, organizationId }, include: { items: true } });
    if (!order) {
      throw notFound('Order not found');
    }
    response.json(orderResponse(order));
  }));

  router.get('/v1/orders', route(async (request, response) => {
    caller();
    const search = typeof request.query.search === 'string' ? request.query.search : null;
    const status = queryParam(request, 'status', `enum:${STATUSES}`);
    const paging = pageable(request);
    const organizationId = organizationOf(caller(Permissions.ORDER_READ));
    let where: Prisma.OrderWhereInput = { organizationId };
    if (search) {
      // As Java's query: orders whose customer's name or email contains the text.
      const customers = await prisma.customer.findMany({ select: { id: true },
        where: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } });
      where = { organizationId, customerId: { in: customers.map((c) => c.id) } };
    } else if (status) {
      where = { organizationId, status };
    }
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, include: { items: true }, orderBy: orderBy(paging, 'Order', PROPERTIES), skip: paging.page * paging.size, take: paging.size }),
      prisma.order.count({ where }),
    ]);
    response.json(page(rows.map(orderResponse), total, paging));
  }));

  router.patch('/v1/orders/:id/status', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const body = bind(request, { status: { kind: `enum:${STATUSES}`, rules: [rules.notNull('Status is required')] } });
    const me = caller(Permissions.ORDER_CREATE, Permissions.ORDER_CANCEL);
    const organizationId = organizationOf(me);
    const next = body.status as string;
    response.json(await inTx(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, organizationId }, include: { items: true } });
      if (!order) {
        throw notFound('Order not found');
      }
      const current = order.status;
      if (!validTransition(current, next)) {
        throw invalidTransition(`Invalid status transition from ${current} to ${next}`);
      }
      const required = next === 'CANCELLED' ? Permissions.ORDER_CANCEL : Permissions.ORDER_CREATE;
      if (!me.authorities.has(required)) {
        throw accessDenied(`Missing permission: ${required}`);
      }
      const before = orderResponse(order);
      // docs:region order-status-cas
      // A bulk update, as Java's: the status only if it is still what was read, and updated_at untouched.
      const updated = await tx.$executeRawUnsafe(`UPDATE orders SET status = $4 WHERE id = $1::uuid AND organization_id = $2::uuid AND status = $3`,
        id, organizationId, current, next);
      if (updated === 0) {
        throw invalidTransition(`Order status changed concurrently — expected ${current}, please retry`);
      }
      // docs:end
      for (const item of order.items) {
        if (item.warehouseId === null) {
          continue;
        }
        const stock = await tx.inventory.findFirst({ where: { organizationId, warehouseId: item.warehouseId, productId: item.productId } });
        if (stock && next === 'CANCELLED') {
          await inventory.release(tx, organizationId, stock.id, item.quantity);
        } else if (stock && next === 'COMPLETED') {
          await inventory.consumeReserved(tx, organizationId, stock.id, item.quantity);
        }
      }
      const saved = (await tx.order.findFirst({ where: { id, organizationId }, include: { items: true } }))!;
      const result = orderResponse(saved);
      await auditor.record(audit(AuditActions.ORDER_STATUS_CHANGED).organization(organizationId).entity('order', saved.id)
        .before(plain(before)).after(plain(result)).detail('from', current).detail('to', next).build());
      if (next === 'CANCELLED') {
        await inventory.notifications.orderCancelled(organizationId, { id: saved.id, customerId: saved.customerId, totalAmount: saved.totalAmount.toFixed(2) });
      }
      dashboard.evict(organizationId);
      return result;
    }));
  }));

  return router;
}
