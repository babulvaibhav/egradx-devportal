import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { egradxTransaction } from '@babulvaibhav/egradx-sdk';
import { Prisma, type Product } from './generated/prisma/client.js';
import { bind, caller, conflict, money, notFound, orderBy, page, pageable, plain, queryParam, route, rules, uuidParam } from './http.js';
import { AuditActions, Permissions, audit, organizationOf, type Oim } from './oim.js';
import { localDateTime, localNow } from './time.js';

const PROPERTIES = ['id', 'organizationId', 'sku', 'name', 'description', 'price', 'status', 'createdAt', 'updatedAt'];

/** As Java's ProductResponse. */
export const productResponse = (p: Product) => ({
  id: p.id, sku: p.sku, name: p.name, description: p.description, price: money(p.price), status: p.status,
  createdAt: localDateTime(p.createdAt), updatedAt: localDateTime(p.updatedAt),
});

const productRequest = {
  sku: { kind: 'string' as const, rules: [rules.notBlank('SKU is required'), rules.maxLength(50, 'SKU must not exceed 50 characters')] },
  name: { kind: 'string' as const, rules: [rules.notBlank('Name is required'), rules.maxLength(200, 'Name must not exceed 200 characters')] },
  description: { kind: 'string' as const, rules: [rules.maxLength(1000, 'Description must not exceed 1000 characters')] },
  price: { kind: 'decimal' as const, rules: [rules.notNull('Price is required'), rules.decimalMin('0.01', 'Price must be greater than 0'),
    rules.digits(8, 2, 'Price must have at most 8 integer digits and 2 decimal digits')] },
  status: { kind: 'enum:ACTIVE|DISABLED' as const },
};

/** /v1/products, as Java's ProductController and ProductService. */
export function productRoutes(oim: Oim): Router {
  const router = Router();
  const { prisma, auditor, dashboard } = oim;

  // docs:region create-product (apps/egradx-devportal shows this)
  router.post('/v1/products', route(async (request, response) => {
    caller();
    const body = bind(request, productRequest);
    const organizationId = organizationOf(caller(Permissions.PRODUCT_WRITE));
    response.json(await egradxTransaction(prisma, async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient;
      if (await tx.product.findFirst({ where: { organizationId, sku: body.sku as string } })) {
        throw conflict(`Product with SKU ${body.sku} already exists in this organization`);
      }
      const now = localNow();
      const saved = await tx.product.create({ data: { id: randomUUID(), organizationId, sku: body.sku as string, name: body.name as string,
        description: body.description as string | null, price: new Prisma.Decimal(String(body.price)), status: (body.status as string | null) ?? 'ACTIVE',
        createdAt: now, updatedAt: now } });
      const result = productResponse(saved);
      await auditor.record(audit(AuditActions.PRODUCT_CREATED).organization(organizationId).entity('product', saved.id, saved.name).after(plain(result)).build());
      dashboard.evict(organizationId);
      return result;
    }));
  }));
  // docs:end

  router.get('/v1/products/:id', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const organizationId = organizationOf(caller(Permissions.PRODUCT_READ));
    const product = await prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) {
      throw notFound('Product not found');
    }
    response.json(productResponse(product));
  }));

  router.get('/v1/products', route(async (request, response) => {
    caller();
    const search = typeof request.query.search === 'string' ? request.query.search : null;
    const status = queryParam(request, 'status', 'enum:ACTIVE|DISABLED');
    const paging = pageable(request);
    const organizationId = organizationOf(caller(Permissions.PRODUCT_READ));
    const where: Prisma.ProductWhereInput = search
      ? { organizationId, OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] }
      : status ? { organizationId, status } : { organizationId };
    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: orderBy(paging, 'Product', PROPERTIES), skip: paging.page * paging.size, take: paging.size }),
      prisma.product.count({ where }),
    ]);
    response.json(page(rows.map(productResponse), total, paging));
  }));

  router.patch('/v1/products/:id', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const body = bind(request, productRequest);
    const organizationId = organizationOf(caller(Permissions.PRODUCT_WRITE));
    response.json(await egradxTransaction(prisma, async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient;
      const product = await tx.product.findFirst({ where: { id, organizationId } });
      if (!product) {
        throw notFound('Product not found');
      }
      if (product.sku !== body.sku && await tx.product.findFirst({ where: { organizationId, sku: body.sku as string } })) {
        throw conflict(`Product with SKU ${body.sku} already exists in this organization`);
      }
      // docs:region update-product-audit
      const before = productResponse(product);
      const changes = { sku: body.sku as string, name: body.name as string, description: body.description as string | null,
        price: new Prisma.Decimal(String(body.price)), status: (body.status as string | null) ?? product.status };
      const saved = await saveIfChanged(tx, product, changes);
      const result = productResponse(saved);
      await auditor.record(audit(AuditActions.PRODUCT_UPDATED).organization(organizationId).entity('product', saved.id, saved.name)
        .before(plain(before)).after(plain(result)).build());
      dashboard.evict(organizationId);
      // docs:end
      return result;
    }));
  }));

  router.patch('/v1/products/:id/disable', route(async (request, response) => {
    caller();
    const id = uuidParam(request, 'id');
    const organizationId = organizationOf(caller(Permissions.PRODUCT_WRITE));
    await egradxTransaction(prisma, async (raw) => {
      const tx = raw as unknown as Prisma.TransactionClient;
      const product = await tx.product.findFirst({ where: { id, organizationId } });
      if (!product) {
        throw notFound('Product not found');
      }
      const before = productResponse(product);
      const saved = await saveIfChanged(tx, product, { status: 'DISABLED' });
      await auditor.record(audit(AuditActions.PRODUCT_DISABLED).organization(organizationId).entity('product', id, saved.name)
        .before(plain(before)).after(plain(productResponse(saved))).build());
      dashboard.evict(organizationId);
    });
    response.status(200).end();
  }));

  return router;
}

/** As Hibernate's dirty checking: written, with a new updatedAt, only if something changed. */
export function changedFields<T extends object>(entity: T, changes: Partial<T>): boolean {
  return Object.entries(changes).some(([key, value]) => {
    const current = entity[key as keyof T];
    return value instanceof Prisma.Decimal ? !value.equals(current as unknown as Prisma.Decimal) : value !== current;
  });
}

async function saveIfChanged(tx: Prisma.TransactionClient, product: Product, changes: Partial<Product>): Promise<Product> {
  return changedFields(product, changes) ? tx.product.update({ where: { id: product.id }, data: { ...changes, updatedAt: localNow() } }) : product;
}
