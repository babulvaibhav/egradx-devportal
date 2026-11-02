import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { egradxTransaction, type SqlClient } from '@babulvaibhav/egradx-sdk';
import type { Inventory, Prisma } from './generated/prisma/client.js';
import { bind, caller, conflict, insufficientInventory, invalidRequest, invalidValue, notFound, orderBy, page, pageable, plain, queryParam, route, rules,
  uuidParam } from './http.js';
import { AuditActions, OimNotifications, Permissions, audit, organizationOf, type Oim } from './oim.js';
import { localDateTime, localNow } from './time.js';

export const LOW_STOCK_THRESHOLD = 10;
const PROPERTIES = ['id', 'organizationId', 'warehouseId', 'productId', 'availableQuantity', 'reservedQuantity', 'version', 'createdAt', 'updatedAt'];

/** As Java's InventoryResponse. */
export const inventoryResponse = (i: Inventory) => ({
  id: i.id, warehouseId: i.warehouseId, productId: i.productId, availableQuantity: i.availableQuantity, reservedQuantity: i.reservedQuantity,
  totalQuantity: i.availableQuantity + i.reservedQuantity, version: i.version, updatedAt: localDateTime(i.updatedAt),
});

/** Java's UUID.compareTo: the two halves compared as signed 64-bit numbers (not PostgreSQL's byte order). */
export function compareJavaUuids(a: string, b: string): number {
  const halves = (uuid: string) => {
    const hex = uuid.replace(/-/g, '');
    return [BigInt.asIntN(64, BigInt(`0x${hex.slice(0, 16)}`)), BigInt.asIntN(64, BigInt(`0x${hex.slice(16)}`))];
  };
  const [x, y] = [halves(a), halves(b)];
  for (let i = 0; i < 2; i++) {
    if (x[i]! !== y[i]!) {
      return x[i]! < y[i]! ? -1 : 1;
    }
  }
  return 0;
}

/*
 * The stock movements, as Java's InventoryRepository's bulk updates: each changes the row only if the stock
 * allows, and (being bulk updates) leaves its version and updated_at as they were.
 */
// docs:region stock-moves
export const stock = {
  reserve: (tx: SqlClient, id: string, organizationId: string, quantity: number) => tx.$executeRawUnsafe(`UPDATE inventory
    SET available_quantity = available_quantity - $3, reserved_quantity = reserved_quantity + $3
    WHERE id = $1::uuid AND organization_id = $2::uuid AND available_quantity >= $3`, id, organizationId, quantity),
  release: (tx: SqlClient, id: string, organizationId: string, quantity: number) => tx.$executeRawUnsafe(`UPDATE inventory
    SET available_quantity = available_quantity + $3, reserved_quantity = reserved_quantity - $3
    WHERE id = $1::uuid AND organization_id = $2::uuid AND reserved_quantity >= $3`, id, organizationId, quantity),
  consumeReserved: (tx: SqlClient, id: string, organizationId: string, quantity: number) => tx.$executeRawUnsafe(`UPDATE inventory
    SET reserved_quantity = reserved_quantity - $3 WHERE id = $1::uuid AND organization_id = $2::uuid AND reserved_quantity >= $3`, id, organizationId, quantity),
  add: (tx: SqlClient, id: string, organizationId: string, quantity: number) => tx.$executeRawUnsafe(`UPDATE inventory
    SET available_quantity = available_quantity + $3 WHERE id = $1::uuid AND organization_id = $2::uuid`, id, organizationId, quantity),
  subtract: (tx: SqlClient, id: string, organizationId: string, quantity: number) => tx.$executeRawUnsafe(`UPDATE inventory
    SET available_quantity = available_quantity - $3 WHERE id = $1::uuid AND organization_id = $2::uuid AND available_quantity >= $3`, id, organizationId, quantity),
};
// docs:end

/** Whether this decrease took the stock from at or above the threshold to below it: the one moment an alert is due. */
export const crossesBelowThreshold = (availableAfter: number, decrease: number) =>
  availableAfter < LOW_STOCK_THRESHOLD && availableAfter + decrease >= LOW_STOCK_THRESHOLD;

/** The operations orders share with the inventory endpoints. As Java's InventoryService. */
export class InventoryOperations {
  readonly #notifications: OimNotifications;

  constructor(private readonly oim: Oim) {
    this.#notifications = new OimNotifications(oim);
  }

  get notifications(): OimNotifications {
    return this.#notifications;
  }

  async reserve(tx: Prisma.TransactionClient, organizationId: string, inventoryId: string, quantity: number): Promise<void> {
    if (await stock.reserve(tx, inventoryId, organizationId, quantity) === 0) {
      throw insufficientInventory('Requested quantity is unavailable');
    }
    const inventory = await tx.inventory.findFirst({ where: { id: inventoryId, organizationId } });
    if (inventory) {
      await this.notifyIfLowStockCrossed(organizationId, inventory, quantity);
    }
    this.oim.dashboard.evict(organizationId);
  }

  async release(tx: Prisma.TransactionClient, organizationId: string, inventoryId: string, quantity: number): Promise<void> {
    if (await stock.release(tx, inventoryId, organizationId, quantity) === 0) {
      throw conflict('Failed to release inventory - insufficient reserved quantity');
    }
    this.oim.dashboard.evict(organizationId);
  }

  async consumeReserved(tx: Prisma.TransactionClient, organizationId: string, inventoryId: string, quantity: number): Promise<void> {
    if (await stock.consumeReserved(tx, inventoryId, organizationId, quantity) === 0) {
      throw conflict('Failed to consume reservation - insufficient reserved quantity');
    }
  }

  async notifyIfLowStockCrossed(organizationId: string, inventory: Inventory, decrease: number): Promise<void> {
    if (crossesBelowThreshold(inventory.availableQuantity, decrease)) {
      await this.#notifications.inventoryLow(organizationId, inventory, LOW_STOCK_THRESHOLD);
    }
  }
}

/** A required positive Integer query parameter, as the Java controller's @RequestParam @NotNull @Positive. */
function positiveQuantity(request: Request): number {
  const raw = request.query.quantity;
  const text = Array.isArray(raw) ? raw[0] : raw;
  // A missing parameter is 400, as Spring means it to be. (The Java backend's security answers 401, a defect.)
  if (text === undefined || text === '') {
    throw invalidRequest('Required request parameter \'quantity\' for method parameter type Integer is not present');
  }
  if (typeof text !== 'string' || !/^-?\d+$/.test(text.trim())) {
    throw invalidValue('quantity', text);
  }
  const quantity = Number(text);
  if (!(quantity > 0)) {
    throw invalidRequest('Quantity must be positive');
  }
  return quantity;
}

function requiredUuidQuery(request: Request, name: string): string {
  const value = queryParam(request, name, 'uuid');
  if (value === null) {
    throw invalidRequest(`Required request parameter '${name}' for method parameter type UUID is not present`);
  }
  return value;
}

/** /v1/inventory, as Java's InventoryController and InventoryService. */
export function inventoryRoutes(oim: Oim, operations: InventoryOperations): Router {
  const router = Router();
  const { prisma, auditor, dashboard } = oim;
  const inTx = <R>(fn: (tx: Prisma.TransactionClient) => Promise<R>) => egradxTransaction(prisma, (raw) => fn(raw as unknown as Prisma.TransactionClient));
  const requireInventory = async (tx: Prisma.TransactionClient, id: string, organizationId: string) => {
    const inventory = await tx.inventory.findFirst({ where: { id, organizationId } });
    if (!inventory) {
      throw notFound('Inventory not found');
    }
    return inventory;
  };

  router.post('/v1/inventory', route(async (request, response) => {
    caller();
    const body = bind(request, {
      warehouseId: { kind: 'uuid', rules: [rules.notNull('Warehouse ID is required')] },
      productId: { kind: 'uuid', rules: [rules.notNull('Product ID is required')] },
      quantity: { kind: 'integer', rules: [rules.notNull('Quantity is required'), rules.positive('Quantity must be positive')] },
    });
    const organizationId = organizationOf(caller(Permissions.INVENTORY_UPDATE));
    response.json(await inTx(async (tx) => {
      const [warehouseId, productId] = [body.warehouseId as string, body.productId as string];
      if (!(await tx.warehouse.findFirst({ where: { id: warehouseId, organizationId } }))) {
        throw notFound('Warehouse not found');
      }
      if (!(await tx.product.findFirst({ where: { id: productId, organizationId } }))) {
        throw notFound('Product not found');
      }
      if (await tx.inventory.findFirst({ where: { organizationId, warehouseId, productId } })) {
        throw conflict('Inventory already exists for this warehouse and product');
      }
      const now = localNow();
      const saved = await tx.inventory.create({ data: { id: randomUUID(), organizationId, warehouseId, productId, availableQuantity: body.quantity as number,
        reservedQuantity: 0, version: 0, createdAt: now, updatedAt: now } });
      const result = inventoryResponse(saved);
      await auditor.record(audit(AuditActions.INVENTORY_CREATED).organization(organizationId).entity('inventory', saved.id).after(plain(result)).build());
      dashboard.evict(organizationId);
      return result;
    }));
  }));

  router.get('/v1/inventory/:id', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const organizationId = organizationOf(caller(Permissions.INVENTORY_READ));
    response.json(inventoryResponse(await requireInventory(prisma as unknown as Prisma.TransactionClient, id, organizationId)));
  }));

  router.get('/v1/inventory', route(async (request, response) => {
    caller();
    const warehouseId = queryParam(request, 'warehouseId', 'uuid');
    const productId = queryParam(request, 'productId', 'uuid');
    const paging = pageable(request);
    const organizationId = organizationOf(caller(Permissions.INVENTORY_READ));
    const where: Prisma.InventoryWhereInput = warehouseId ? { organizationId, warehouseId } : productId ? { organizationId, productId } : { organizationId };
    const [rows, total] = await Promise.all([
      prisma.inventory.findMany({ where, orderBy: orderBy(paging, 'Inventory', PROPERTIES), skip: paging.page * paging.size, take: paging.size }),
      prisma.inventory.count({ where }),
    ]);
    response.json(page(rows.map(inventoryResponse), total, paging));
  }));

  router.post('/v1/inventory/adjust', route(async (request, response) => {
    caller();
    const body = bind(request, {
      inventoryId: { kind: 'uuid', rules: [rules.notNull('Inventory ID is required')] },
      quantity: { kind: 'integer', rules: [rules.notNull('Quantity is required'),
        rules.range(-10000, 10000, 'Quantity adjustment must be between -10000 and 10000')] },
      reason: { kind: 'string', rules: [rules.maxLength(500, 'Reason must not exceed 500 characters')] },
    });
    const organizationId = organizationOf(caller(Permissions.INVENTORY_UPDATE));
    const [inventoryId, quantity] = [body.inventoryId as string, body.quantity as number];
    response.json(await inTx(async (tx) => {
      const before = inventoryResponse(await requireInventory(tx, inventoryId, organizationId));
      const affected = quantity >= 0 ? await stock.add(tx, inventoryId, organizationId, quantity) : await stock.subtract(tx, inventoryId, organizationId, -quantity);
      if (affected === 0) {
        throw insufficientInventory('Insufficient inventory for adjustment');
      }
      const saved = await requireInventory(tx, inventoryId, organizationId);
      const result = inventoryResponse(saved);
      // The reason is kept on the adjustment's audit record, which holds the before and after quantities, as Java does.
      const adjusted = audit(AuditActions.INVENTORY_ADJUSTED).organization(organizationId).entity('inventory', saved.id).before(plain(before)).after(plain(result));
      const reason = body.reason as string | null;
      if (reason !== null && reason.trim() !== '') {
        adjusted.detail('reason', reason);
      }
      await auditor.record(adjusted.build());
      await operations.notifications.inventoryUpdated(organizationId, result);
      await operations.notifyIfLowStockCrossed(organizationId, saved, -quantity);
      dashboard.evict(organizationId);
      return result;
    }));
  }));

  router.post('/v1/inventory/transfer', route(async (request, response) => {
    caller();
    const body = bind(request, {
      productId: { kind: 'uuid', rules: [rules.notNull('Product ID is required')] },
      sourceWarehouseId: { kind: 'uuid', rules: [rules.notNull('Source Warehouse ID is required')] },
      destinationWarehouseId: { kind: 'uuid', rules: [rules.notNull('Destination Warehouse ID is required')] },
      quantity: { kind: 'integer', rules: [rules.notNull('Quantity is required'), rules.positive('Quantity must be positive')] },
    });
    const organizationId = organizationOf(caller(Permissions.INVENTORY_UPDATE));
    const transfer = { productId: body.productId as string, sourceWarehouseId: body.sourceWarehouseId as string,
      destinationWarehouseId: body.destinationWarehouseId as string, quantity: body.quantity as number };
    await inTx(async (tx) => {
      if (transfer.sourceWarehouseId === transfer.destinationWarehouseId) {
        throw conflict('Source and destination warehouses cannot be the same');
      }
      if (!(await tx.warehouse.findFirst({ where: { id: transfer.sourceWarehouseId, organizationId } }))) {
        throw notFound('Source warehouse not found');
      }
      if (!(await tx.warehouse.findFirst({ where: { id: transfer.destinationWarehouseId, organizationId } }))) {
        throw notFound('Destination warehouse not found');
      }
      if (!(await tx.product.findFirst({ where: { id: transfer.productId, organizationId } }))) {
        throw notFound('Product not found');
      }
      const source = await tx.inventory.findFirst({ where: { organizationId, warehouseId: transfer.sourceWarehouseId, productId: transfer.productId } });
      if (!source) {
        throw notFound('Source inventory not found');
      }
      const destination = await tx.inventory.findFirst({ where: { organizationId, warehouseId: transfer.destinationWarehouseId, productId: transfer.productId } });
      const debit = async () => {
        if (await stock.subtract(tx, source.id, organizationId, transfer.quantity) === 0) {
          throw insufficientInventory('Insufficient inventory in source warehouse');
        }
      };
      const credit = async () => {
        if (!destination) {
          const now = localNow();
          await tx.inventory.create({ data: { id: randomUUID(), organizationId, warehouseId: transfer.destinationWarehouseId, productId: transfer.productId,
            availableQuantity: transfer.quantity, reservedQuantity: 0, version: 0, createdAt: now, updatedAt: now } });
        } else {
          await stock.add(tx, destination.id, organizationId, transfer.quantity);
        }
      };
      // docs:region transfer-lock-order
      // The rows in one order (Java's), so two opposite transfers can't deadlock.
      if (!destination || compareJavaUuids(source.id, destination.id) <= 0) {
        await debit();
        await credit();
      } else {
        await credit();
        await debit();
      }
      // docs:end
      const refreshed = (await tx.inventory.findFirst({ where: { id: source.id, organizationId } })) ?? source;
      await auditor.record(audit(AuditActions.INVENTORY_TRANSFERRED).organization(organizationId).entity('inventory', source.id)
        .detail('productId', transfer.productId).detail('fromWarehouseId', transfer.sourceWarehouseId)
        .detail('toWarehouseId', transfer.destinationWarehouseId).detail('quantity', transfer.quantity).build());
      await operations.notifications.inventoryTransferred(organizationId, transfer);
      await operations.notifyIfLowStockCrossed(organizationId, refreshed, transfer.quantity);
      dashboard.evict(organizationId);
    });
    response.status(200).end();
  }));

  router.post('/v1/inventory/reserve', route(async (request, response) => {
    caller();
    const inventoryId = requiredUuidQuery(request, 'inventoryId');
    const quantity = positiveQuantity(request);
    const organizationId = organizationOf(caller(Permissions.INVENTORY_UPDATE));
    await inTx((tx) => operations.reserve(tx, organizationId, inventoryId, quantity));
    response.status(200).end();
  }));

  router.post('/v1/inventory/release', route(async (request, response) => {
    caller();
    const inventoryId = requiredUuidQuery(request, 'inventoryId');
    const quantity = positiveQuantity(request);
    const organizationId = organizationOf(caller(Permissions.INVENTORY_UPDATE));
    await inTx((tx) => operations.release(tx, organizationId, inventoryId, quantity));
    response.status(200).end();
  }));

  return router;
}
