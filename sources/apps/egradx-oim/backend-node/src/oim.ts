import { type Auditor, type Auth, type EgradxFileStorage, currentTransaction, EgradxAuditEvent, type EgradxCaller, EgradxMessageRequest, EgradxNotificationType, EgradxObservations, type Notifications, otelMetrics, type SqlClient } from '@babulvaibhav/egradx-sdk';
import type { PrismaClient } from './generated/prisma/client.js';
import { tenantDenied } from './http.js';

/** What every part of the application is given. */
export interface Oim {
  prisma: PrismaClient;
  auth: Auth;
  auditor: Auditor;
  notifications: Notifications;
  /** Uploaded files: order attachments and profile photos. */
  files?: EgradxFileStorage;
  dashboard: DashboardCache;
  log: { info(message: string): void; warn(message: string): void; error(message: string, error?: unknown): void };
  lowStockChannels: readonly string[];
}

/** OIM's business permissions, as Java's PermissionCodes. The identity ones (egradx.*) are the SDK's. */
// docs:region permission-catalog
export const Permissions = {
  PRODUCT_READ: 'product.read',
  PRODUCT_WRITE: 'product.write',
  WAREHOUSE_READ: 'warehouse.read',
  WAREHOUSE_WRITE: 'warehouse.write',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_UPDATE: 'inventory.update',
  ORDER_READ: 'order.read',
  ORDER_CREATE: 'order.create',
  ORDER_CANCEL: 'order.cancel',
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_WRITE: 'customer.write',
} as const;

export const PERMISSION_CATALOG = [
  [Permissions.PRODUCT_READ, 'View products', 'product'], [Permissions.PRODUCT_WRITE, 'Create, edit and disable products', 'product'],
  [Permissions.WAREHOUSE_READ, 'View warehouses', 'warehouse'], [Permissions.WAREHOUSE_WRITE, 'Create, edit and disable warehouses', 'warehouse'],
  [Permissions.INVENTORY_READ, 'View inventory levels', 'inventory'], [Permissions.INVENTORY_UPDATE, 'Adjust, transfer and reserve inventory', 'inventory'],
  [Permissions.ORDER_READ, 'View orders', 'order'], [Permissions.ORDER_CREATE, 'Create orders and advance their status', 'order'],
  [Permissions.ORDER_CANCEL, 'Cancel orders', 'order'], [Permissions.CUSTOMER_READ, 'View customers', 'customer'],
  [Permissions.CUSTOMER_WRITE, 'Create and edit customers', 'customer'],
].map(([name, description, category]) => ({ name: name!, description: description!, category: category! }));

const ALL_BUSINESS = Object.values(Permissions);
export const DEFAULT_ADMIN = ALL_BUSINESS;
export const DEFAULT_MANAGER = [...ALL_BUSINESS, 'egradx.audit.read'];
export const DEFAULT_STAFF = [Permissions.PRODUCT_READ, Permissions.WAREHOUSE_READ, Permissions.INVENTORY_READ, Permissions.ORDER_READ,
  Permissions.ORDER_CREATE, Permissions.CUSTOMER_READ];
// docs:end

/** OIM's audit actions, as Java's OimAuditActions. */
export const AuditActions = {
  PRODUCT_CREATED: 'oim.product.created', PRODUCT_UPDATED: 'oim.product.updated', PRODUCT_DISABLED: 'oim.product.disabled',
  WAREHOUSE_CREATED: 'oim.warehouse.created', WAREHOUSE_UPDATED: 'oim.warehouse.updated', WAREHOUSE_DISABLED: 'oim.warehouse.disabled',
  CUSTOMER_CREATED: 'oim.customer.created', CUSTOMER_UPDATED: 'oim.customer.updated',
  ORDER_CREATED: 'oim.order.created', ORDER_STATUS_CHANGED: 'oim.order.status_changed',
  INVENTORY_CREATED: 'oim.inventory.created', INVENTORY_ADJUSTED: 'oim.inventory.adjusted', INVENTORY_TRANSFERRED: 'oim.inventory.transferred',
} as const;

export const AUDIT_ACTIONS = [
  [AuditActions.PRODUCT_CREATED, 'Created a product', 'product'], [AuditActions.PRODUCT_UPDATED, 'Edited a product', 'product'],
  [AuditActions.PRODUCT_DISABLED, 'Disabled a product', 'product'], [AuditActions.WAREHOUSE_CREATED, 'Created a warehouse', 'warehouse'],
  [AuditActions.WAREHOUSE_UPDATED, 'Edited a warehouse', 'warehouse'], [AuditActions.WAREHOUSE_DISABLED, 'Disabled a warehouse', 'warehouse'],
  [AuditActions.CUSTOMER_CREATED, 'Created a customer', 'customer'], [AuditActions.CUSTOMER_UPDATED, 'Edited a customer', 'customer'],
  [AuditActions.ORDER_CREATED, 'Created an order', 'order'], [AuditActions.ORDER_STATUS_CHANGED, 'Changed an order\'s status', 'order'],
  [AuditActions.INVENTORY_CREATED, 'Added stock of a product to a warehouse', 'inventory'], [AuditActions.INVENTORY_ADJUSTED, 'Adjusted stock', 'inventory'],
  [AuditActions.INVENTORY_TRANSFERRED, 'Moved stock between warehouses', 'inventory'],
].map(([action, description, entityType]) => ({ action: action!, description: description!, entityType: entityType! }));

export const audit = (action: string) => EgradxAuditEvent.of(action);

/** The organization the caller acts in, as Java's CurrentTenant.organizationId(). */
// docs:region current-tenant
export function organizationOf(caller: EgradxCaller | undefined): string {
  if (!caller) {
    throw tenantDenied('No authenticated caller on this request');
  }
  if (!caller.organizationId) {
    throw tenantDenied('This operation requires acting within an organization');
  }
  return caller.organizationId;
}
// docs:end

// --- notifications ----------------------------------------------------------------------------

export const NotificationKeys = {
  ORDER_CREATED: 'oim.order.created',
  ORDER_CANCELLED: 'oim.order.cancelled',
  INVENTORY_UPDATED: 'oim.inventory.updated',
  INVENTORY_TRANSFER_COMPLETED: 'oim.inventory.transfer-completed',
  INVENTORY_LOW: 'oim.inventory.low',
} as const;

/** The kinds of message OIM sends, as Java's OimNotificationTypes. */
export const notificationTypes = () => [
  EgradxNotificationType.builder(NotificationKeys.INVENTORY_LOW).description('Stock of a product in a warehouse fell below the low-stock threshold')
    .requires('productName', 'productSku', 'warehouseName', 'remainingQuantity', 'threshold').userCanOptOut().build(),
];

/** Metadata as Java's OimNotifications.meta: nulls left out, anything but numbers and booleans as text. */
function meta(...namesAndValues: unknown[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (let i = 0; i < namesAndValues.length; i += 2) {
    const value = namesAndValues[i + 1];
    if (value !== null && value !== undefined) {
      metadata[namesAndValues[i] as string] = typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    }
  }
  return metadata;
}

/**
 * The in-app notifications OIM publishes (in the change's transaction), and the low-stock alert it sends
 * to the organization's members after the commit. As Java's OimNotifications and LowStockAlerts.
 */
export class OimNotifications {
  constructor(private readonly oim: Pick<Oim, 'notifications' | 'prisma' | 'log' | 'lowStockChannels'>) {}

  orderCreated(organizationId: string, order: { id: string; customerId: string; status: string; totalAmount: string; itemCount: number }) {
    return this.#publish(organizationId, NotificationKeys.ORDER_CREATED, 'New order', `New order created (total: ${order.totalAmount})`,
      meta('orderId', order.id, 'customerId', order.customerId, 'status', order.status, 'totalAmount', order.totalAmount, 'itemCount', order.itemCount));
  }

  orderCancelled(organizationId: string, order: { id: string; customerId: string; totalAmount: string }) {
    return this.#publish(organizationId, NotificationKeys.ORDER_CANCELLED, 'Order cancelled', `Order ${order.id} was cancelled`,
      meta('orderId', order.id, 'customerId', order.customerId, 'totalAmount', order.totalAmount));
  }

  inventoryUpdated(organizationId: string, inventory: { id: string; productId: string; warehouseId: string; availableQuantity: number; reservedQuantity: number }) {
    return this.#publish(organizationId, NotificationKeys.INVENTORY_UPDATED, 'Inventory updated', `Inventory updated: ${inventory.availableQuantity} now available`,
      meta('inventoryId', inventory.id, 'productId', inventory.productId, 'warehouseId', inventory.warehouseId,
        'availableQuantity', inventory.availableQuantity, 'reservedQuantity', inventory.reservedQuantity));
  }

  inventoryTransferred(organizationId: string, transfer: { productId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: number }) {
    return this.#publish(organizationId, NotificationKeys.INVENTORY_TRANSFER_COMPLETED, 'Transfer completed',
      `Transferred ${transfer.quantity} unit(s) between warehouses`,
      meta('productId', transfer.productId, 'sourceWarehouseId', transfer.sourceWarehouseId, 'destinationWarehouseId', transfer.destinationWarehouseId,
        'quantity', transfer.quantity));
  }

  // docs:region low-stock-in-app
  async inventoryLow(organizationId: string, inventory: { id: string; productId: string; warehouseId: string; availableQuantity: number }, threshold: number) {
    await this.#publish(organizationId, NotificationKeys.INVENTORY_LOW, 'Low stock', `Inventory running low: ${inventory.availableQuantity} left`,
      meta('inventoryId', inventory.id, 'productId', inventory.productId, 'warehouseId', inventory.warehouseId, 'remainingQuantity', inventory.availableQuantity,
        'threshold', threshold));
    const alert = () => this.#lowStockAlert(organizationId, inventory, threshold);
    const surrounding = currentTransaction();
    if (surrounding) {
      surrounding.afterCommit(alert);
    } else {
      await alert();
    }
  }

  #publish(organizationId: string, notificationKey: string, title: string, body: string, metadata: Record<string, unknown>) {
    return this.oim.notifications.publishToOrganization(organizationId, { notificationKey, title, body, metadata });
  }
  // docs:end

  /**
   * Sent after the commit, each channel in a transaction of its own, every failure logged and nothing
   * thrown: a message must never break the stock change it is about. Only on channels the organization
   * can send on.
   */
  // docs:region low-stock-alert
  async #lowStockAlert(organizationId: string, inventory: { productId: string; warehouseId: string; availableQuantity: number }, threshold: number) {
    try {
      const { prisma } = this.oim;
      const product = await prisma.product.findFirst({ where: { id: inventory.productId, organizationId } });
      const warehouse = await prisma.warehouse.findFirst({ where: { id: inventory.warehouseId, organizationId } });
      const model = {
        productName: product?.name ?? `Product ${inventory.productId}`,
        productSku: product?.sku ?? '-',
        warehouseName: warehouse?.name ?? `Warehouse ${inventory.warehouseId}`,
        remainingQuantity: inventory.availableQuantity,
        threshold,
      };
      for (const channelId of this.oim.lowStockChannels) {
        const channel = this.oim.notifications.channels.find(channelId);
        const unavailable = channel ? await channel.unavailableFor?.(organizationId) : 'no such channel is installed';
        if (unavailable) {
          countAlert(channelId, 'skipped');
          continue;
        }
        try {
          const receipt = await this.oim.notifications.messenger.send(EgradxMessageRequest.on(channelId).organization(organizationId)
            .template(NotificationKeys.INVENTORY_LOW, model).toOrganizationMembers().build());
          this.oim.log.info(`Low-stock alert queued on ${channelId} for up to ${receipt.recipients} member(s) (bulk send ${receipt.bulkSendId})`);
          countAlert(channelId, 'queued');
        } catch (error) {
          this.oim.log.warn(`Low-stock alert not queued on ${channelId}: ${error instanceof Error ? error.message : error}`);
          countAlert(channelId, 'failed');
        }
      }
    } catch (error) {
      this.oim.log.warn(`Low-stock alert not sent: ${error instanceof Error ? error.message : error}`);
    }
  }
  // docs:end
}

const metrics = otelMetrics();

/** egradx.oim.low_stock.alert, per channel: queued, skipped (the organization cannot send on it) or failed. As Java's LowStockAlerts. */
function countAlert(channelId: string, outcome: string): void {
  try {
    metrics.increment('egradx.oim.low_stock.alert', EgradxObservations.CHANNEL, channelId, EgradxObservations.OUTCOME, outcome);
  } catch {
    // Counting must never break an alert.
  }
}

// docs:region dashboard-cache
/** The dashboard summary, cached per organization for 60 seconds and evicted after a change commits. As Java's dashboard cache. */
export class DashboardCache {
  readonly #entries = new Map<string, { value: unknown; until: number }>();

  get<T>(organizationId: string): T | undefined {
    const entry = this.#entries.get(organizationId);
    return entry && entry.until > Date.now() ? entry.value as T : undefined;
  }

  put(organizationId: string, value: unknown): void {
    this.#entries.set(organizationId, { value, until: Date.now() + 60_000 });
  }

  /** After the surrounding transaction commits, as Java's DashboardCacheEvictor. */
  evict(organizationId: string): void {
    const evict = () => {
      this.#entries.delete(organizationId);
    };
    const surrounding = currentTransaction();
    if (surrounding) {
      surrounding.afterCommit(evict);
    } else {
      evict();
    }
  }
}
// docs:end

// --- organizations ----------------------------------------------------------------------------

/**
 * What OIM adds to every new organization, in its transaction: its business permissions on the Admin
 * role, and Manager and Staff roles. As Java's OimOrganizationDefaults.
 */
// docs:region organization-defaults
export function organizationDefaults(oim: () => Pick<Oim, 'auth' | 'log'>) {
  return async (created: { organizationId: string; organizationName: string; adminRoleName: string }, _tx: SqlClient) => {
    const { auth, log } = oim();
    await auth.roles.addAuthoritiesToRole(created.organizationId, created.adminRoleName, DEFAULT_ADMIN);
    await auth.roles.createSystemRole(created.organizationId, 'Manager', 'Products, inventory and orders', DEFAULT_MANAGER);
    await auth.roles.createSystemRole(created.organizationId, 'Staff', 'Read access plus order creation', DEFAULT_STAFF);
    log.info(`Seeded default roles for organization '${created.organizationName}': ${created.adminRoleName}, Manager, Staff`);
  };
}
// docs:end

/** OIM's permissions, and one demo organization with its admin, on an empty database. As Java's DataSeeder. */
export async function seed(oim: Pick<Oim, 'auth' | 'log'>, adminPassword: string): Promise<void> {
  const existing = new Set((await oim.auth.roles.listAuthorities()).map((authority) => authority.name));
  let created = 0;
  for (const authority of PERMISSION_CATALOG) {
    if (!existing.has(authority.name)) {
      await oim.auth.roles.createAuthority(authority);
      created++;
    }
  }
  if (created > 0) {
    oim.log.info(`Seeded ${created} authorities into the egradx-auth catalog`);
  }
  const admin = 'admin@egradx.com';
  if (!(await oim.auth.people.userIdByUsername(admin))) {
    await oim.auth.provisioning.provisionOrganization({ name: 'Egradx Consulting Firm',
      admin: { username: admin, email: admin, password: adminPassword, name: 'Demo Admin' } });
    oim.log.info(`Seeded organization 'Egradx Consulting Firm' with admin ${admin}`);
  }
}
