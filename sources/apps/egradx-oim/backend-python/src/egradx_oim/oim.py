"""What every part of OIM is given, and what it adds to the SDK: its permissions and default roles, audit actions,
notification types and messages, the dashboard cache, and the seed. As the Java backend's PermissionCodes,
OimAuditActions, OimNotificationTypes, OimNotifications, LowStockAlerts, OimOrganizationDefaults and DataSeeder."""

import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

from egradx.sdk import (
    EgradxAuditActionDefinition,
    EgradxAuditEvent,
    EgradxAuditEventBuilder,
    EgradxAuditor,
    EgradxAuth,
    EgradxAuthorityDefinition,
    EgradxCaller,
    EgradxInAppMessage,
    EgradxMessageRequest,
    EgradxNotifications,
    EgradxNotificationType,
    EgradxObservations,
    EgradxOrganizationCreated,
    OtelMetrics,
    current_transaction,
    egradx_transaction,
)

from .http import tenant_denied
from .models import Product, Warehouse


@dataclass
class Oim:
    engine: AsyncEngine
    auth: EgradxAuth
    auditor: EgradxAuditor
    notifications: EgradxNotifications
    dashboard: "DashboardCache"
    log: logging.Logger
    low_stock_channels: list[str]
    # egradx-file-storage: its endpoints join egradx_router(oim).
    files: Any = None


@asynccontextmanager
async def transaction(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """An ORM session in the SDK's transaction, which egradx-audit and egradx-notification join: a record and a
    notification commit with the change, or not at all."""
    async with egradx_transaction(engine) as connection:
        session = AsyncSession(bind=connection, expire_on_commit=False)
        try:
            yield session
            await session.flush()
        finally:
            await session.close()


@asynccontextmanager
async def reading(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session


# ---- permissions ---------------------------------------------------------------------------------

# docs:region permission-catalog
class Permissions:
    """OIM's business permissions, as Java's PermissionCodes. The identity ones (egradx.*) are the SDK's."""

    PRODUCT_READ = "product.read"
    PRODUCT_WRITE = "product.write"
    WAREHOUSE_READ = "warehouse.read"
    WAREHOUSE_WRITE = "warehouse.write"
    INVENTORY_READ = "inventory.read"
    INVENTORY_UPDATE = "inventory.update"
    ORDER_READ = "order.read"
    ORDER_CREATE = "order.create"
    ORDER_CANCEL = "order.cancel"
    CUSTOMER_READ = "customer.read"
    CUSTOMER_WRITE = "customer.write"


PERMISSION_CATALOG = [EgradxAuthorityDefinition(name, description, category) for name, description, category in (
    (Permissions.PRODUCT_READ, "View products", "product"), (Permissions.PRODUCT_WRITE, "Create, edit and disable products", "product"),
    (Permissions.WAREHOUSE_READ, "View warehouses", "warehouse"), (Permissions.WAREHOUSE_WRITE, "Create, edit and disable warehouses", "warehouse"),
    (Permissions.INVENTORY_READ, "View inventory levels", "inventory"), (Permissions.INVENTORY_UPDATE, "Adjust, transfer and reserve inventory", "inventory"),
    (Permissions.ORDER_READ, "View orders", "order"), (Permissions.ORDER_CREATE, "Create orders and advance their status", "order"),
    (Permissions.ORDER_CANCEL, "Cancel orders", "order"), (Permissions.CUSTOMER_READ, "View customers", "customer"),
    (Permissions.CUSTOMER_WRITE, "Create and edit customers", "customer"),
)]

_ALL_BUSINESS = [definition.name for definition in PERMISSION_CATALOG]
DEFAULT_ADMIN = _ALL_BUSINESS
DEFAULT_MANAGER = [*_ALL_BUSINESS, "egradx.audit.read"]
DEFAULT_STAFF = [Permissions.PRODUCT_READ, Permissions.WAREHOUSE_READ, Permissions.INVENTORY_READ, Permissions.ORDER_READ, Permissions.ORDER_CREATE,
                 Permissions.CUSTOMER_READ]
# docs:end


# docs:region current-tenant
def organization_of(signed_in: EgradxCaller | None) -> str:
    """The organization the caller acts in, as Java's CurrentTenant.organizationId()."""
    if signed_in is None:
        raise tenant_denied("No authenticated caller on this request")
    if not signed_in.organization_id:
        raise tenant_denied("This operation requires acting within an organization")
    return signed_in.organization_id
# docs:end


# ---- audit ----------------------------------------------------------------------------------------

class AuditActions:
    PRODUCT_CREATED = "oim.product.created"
    PRODUCT_UPDATED = "oim.product.updated"
    PRODUCT_DISABLED = "oim.product.disabled"
    WAREHOUSE_CREATED = "oim.warehouse.created"
    WAREHOUSE_UPDATED = "oim.warehouse.updated"
    WAREHOUSE_DISABLED = "oim.warehouse.disabled"
    CUSTOMER_CREATED = "oim.customer.created"
    CUSTOMER_UPDATED = "oim.customer.updated"
    ORDER_CREATED = "oim.order.created"
    ORDER_STATUS_CHANGED = "oim.order.status_changed"
    INVENTORY_CREATED = "oim.inventory.created"
    INVENTORY_ADJUSTED = "oim.inventory.adjusted"
    INVENTORY_TRANSFERRED = "oim.inventory.transferred"


AUDIT_ACTIONS = [EgradxAuditActionDefinition(action, description, entity_type) for action, description, entity_type in (
    (AuditActions.PRODUCT_CREATED, "Created a product", "product"), (AuditActions.PRODUCT_UPDATED, "Edited a product", "product"),
    (AuditActions.PRODUCT_DISABLED, "Disabled a product", "product"), (AuditActions.WAREHOUSE_CREATED, "Created a warehouse", "warehouse"),
    (AuditActions.WAREHOUSE_UPDATED, "Edited a warehouse", "warehouse"), (AuditActions.WAREHOUSE_DISABLED, "Disabled a warehouse", "warehouse"),
    (AuditActions.CUSTOMER_CREATED, "Created a customer", "customer"), (AuditActions.CUSTOMER_UPDATED, "Edited a customer", "customer"),
    (AuditActions.ORDER_CREATED, "Created an order", "order"), (AuditActions.ORDER_STATUS_CHANGED, "Changed an order's status", "order"),
    (AuditActions.INVENTORY_CREATED, "Added stock of a product to a warehouse", "inventory"), (AuditActions.INVENTORY_ADJUSTED, "Adjusted stock", "inventory"),
    (AuditActions.INVENTORY_TRANSFERRED, "Moved stock between warehouses", "inventory"),
)]


def audit(action: str) -> EgradxAuditEventBuilder:
    return EgradxAuditEvent.of(action)


# ---- notifications --------------------------------------------------------------------------------

class NotificationKeys:
    ORDER_CREATED = "oim.order.created"
    ORDER_CANCELLED = "oim.order.cancelled"
    INVENTORY_UPDATED = "oim.inventory.updated"
    INVENTORY_TRANSFER_COMPLETED = "oim.inventory.transfer-completed"
    INVENTORY_LOW = "oim.inventory.low"


def notification_types() -> list[EgradxNotificationType]:
    """The kinds of message OIM sends, as Java's OimNotificationTypes."""
    return [EgradxNotificationType.builder(NotificationKeys.INVENTORY_LOW).description("Stock of a product in a warehouse fell below the low-stock threshold")
            .requires("productName", "productSku", "warehouseName", "remainingQuantity", "threshold").user_can_opt_out().build()]


def _meta(*names_and_values: Any) -> dict[str, Any]:
    """Metadata as Java's OimNotifications.meta: nulls left out, anything but numbers and booleans as text."""
    metadata: dict[str, Any] = {}
    for i in range(0, len(names_and_values) - 1, 2):
        value = names_and_values[i + 1]
        if value is not None:
            metadata[names_and_values[i]] = value if isinstance(value, (bool, int, float)) else str(value)
    return metadata


class OimNotifications:
    """The in-app notifications OIM publishes (in the change's transaction), and the low-stock alert it sends to the
    organization's members after the commit."""

    def __init__(self, oim: Oim) -> None:
        self._oim = oim

    async def order_created(self, organization_id: str, order_id: str, customer_id: str, status: str, total_amount: str, item_count: int) -> None:
        await self._publish(organization_id, NotificationKeys.ORDER_CREATED, "New order", f"New order created (total: {total_amount})",
                            _meta("orderId", order_id, "customerId", customer_id, "status", status, "totalAmount", total_amount, "itemCount", item_count))

    async def order_cancelled(self, organization_id: str, order_id: str, customer_id: str, total_amount: str) -> None:
        await self._publish(organization_id, NotificationKeys.ORDER_CANCELLED, "Order cancelled", f"Order {order_id} was cancelled",
                            _meta("orderId", order_id, "customerId", customer_id, "totalAmount", total_amount))

    async def inventory_updated(self, organization_id: str, inventory: dict[str, Any]) -> None:
        await self._publish(organization_id, NotificationKeys.INVENTORY_UPDATED, "Inventory updated",
                            f"Inventory updated: {inventory['availableQuantity']} now available",
                            _meta("inventoryId", inventory["id"], "productId", inventory["productId"], "warehouseId", inventory["warehouseId"],
                                  "availableQuantity", inventory["availableQuantity"], "reservedQuantity", inventory["reservedQuantity"]))

    async def inventory_transferred(self, organization_id: str, product_id: str, source_id: str, destination_id: str, quantity: int) -> None:
        await self._publish(organization_id, NotificationKeys.INVENTORY_TRANSFER_COMPLETED, "Transfer completed",
                            f"Transferred {quantity} unit(s) between warehouses",
                            _meta("productId", product_id, "sourceWarehouseId", source_id, "destinationWarehouseId", destination_id, "quantity", quantity))

    # docs:region low-stock-in-app
    async def inventory_low(self, organization_id: str, inventory_id: str, product_id: str, warehouse_id: str, available: int, threshold: int) -> None:
        await self._publish(organization_id, NotificationKeys.INVENTORY_LOW, "Low stock", f"Inventory running low: {available} left",
                            _meta("inventoryId", inventory_id, "productId", product_id, "warehouseId", warehouse_id, "remainingQuantity", available,
                                  "threshold", threshold))

        async def alert() -> None:
            await self._low_stock_alert(organization_id, product_id, warehouse_id, available, threshold)

        surrounding = current_transaction()
        if surrounding is not None:
            surrounding.after_commit(alert)
        else:
            await alert()

    async def _publish(self, organization_id: str, key: str, title: str, body: str, metadata: dict[str, Any]) -> None:
        await self._oim.notifications.publish_to_organization(organization_id, EgradxInAppMessage(title, body, notification_key=key, metadata=metadata))
    # docs:end

    # docs:region low-stock-alert
    async def _low_stock_alert(self, organization_id: str, product_id: str, warehouse_id: str, available: int, threshold: int) -> None:
        """Sent after the commit, each channel in a transaction of its own, every failure logged and nothing raised: a
        message must never break the stock change it is about. Only on channels the organization can send on."""
        log = self._oim.log
        try:
            async with reading(self._oim.engine) as session:
                product = (await session.execute(select(Product).where(Product.id == product_id, Product.organization_id == organization_id))).scalar()
                warehouse = (await session.execute(select(Warehouse).where(Warehouse.id == warehouse_id,
                                                                           Warehouse.organization_id == organization_id))).scalar()
            model = {"productName": product.name if product else f"Product {product_id}", "productSku": product.sku if product else "-",
                     "warehouseName": warehouse.name if warehouse else f"Warehouse {warehouse_id}", "remainingQuantity": available, "threshold": threshold}
            for channel_id in self._oim.low_stock_channels:
                channel = self._oim.notifications.channels.find(channel_id)
                checker = getattr(channel, "unavailable_for", None) if channel is not None else None
                unavailable = "no such channel is installed" if channel is None else (await checker(organization_id) if checker else None)
                if unavailable:
                    _count_alert(channel_id, "skipped")
                    continue
                try:
                    receipt = await self._oim.notifications.messenger.send(EgradxMessageRequest.on(channel_id).organization(organization_id)
                                                                          .template(NotificationKeys.INVENTORY_LOW, model).to_organization_members().build())
                    log.info("Low-stock alert queued on %s for up to %d member(s) (bulk send %s)", channel_id, receipt.recipients, receipt.bulk_send_id)
                    _count_alert(channel_id, "queued")
                except Exception as error:  # noqa: BLE001
                    log.warning("Low-stock alert not queued on %s: %s", channel_id, error)
                    _count_alert(channel_id, "failed")
        except Exception as error:  # noqa: BLE001
            log.warning("Low-stock alert not sent: %s", error)
    # docs:end


_metrics = OtelMetrics()


def _count_alert(channel_id: str, outcome: str) -> None:
    """egradx.oim.low_stock.alert, per channel: queued, skipped (the organization cannot send on it) or failed. As Java's
    LowStockAlerts."""
    try:
        _metrics.increment("egradx.oim.low_stock.alert", EgradxObservations.CHANNEL, channel_id, EgradxObservations.OUTCOME, outcome)
    except Exception:  # noqa: BLE001 - counting must never break an alert
        logging.getLogger("egradx.oim").debug("Could not count a low-stock alert", exc_info=True)


# docs:region dashboard-cache
class DashboardCache:
    """The dashboard summary, cached per organization for 60 seconds and evicted after a change commits. As Java's
    dashboard cache."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[Any, float]] = {}

    def get(self, organization_id: str) -> Any | None:
        entry = self._entries.get(organization_id)
        return entry[0] if entry and entry[1] > time.monotonic() else None

    def put(self, organization_id: str, value: Any) -> None:
        self._entries[organization_id] = (value, time.monotonic() + 60)

    def evict(self, organization_id: str) -> None:
        """After the surrounding transaction commits, as Java's DashboardCacheEvictor."""
        def drop() -> None:
            self._entries.pop(organization_id, None)

        surrounding = current_transaction()
        if surrounding is not None:
            surrounding.after_commit(drop)
        else:
            drop()
# docs:end


# ---- organizations --------------------------------------------------------------------------------

# docs:region organization-defaults
def organization_defaults(oim: Callable[[], Oim]) -> Callable[[EgradxOrganizationCreated, AsyncConnection], Any]:
    """What OIM adds to every new organization, in its transaction: its business permissions on the Admin role, and
    Manager and Staff roles. As Java's OimOrganizationDefaults."""
    async def add(created: EgradxOrganizationCreated, _tx: AsyncConnection) -> None:
        current = oim()
        await current.auth.roles.add_authorities_to_role(created.organization_id, created.admin_role_name, DEFAULT_ADMIN)
        await current.auth.roles.create_system_role(created.organization_id, "Manager", "Products, inventory and orders", DEFAULT_MANAGER)
        await current.auth.roles.create_system_role(created.organization_id, "Staff", "Read access plus order creation", DEFAULT_STAFF)
        current.log.info("Seeded default roles for organization '%s': %s, Manager, Staff", created.organization_name, created.admin_role_name)

    return add
# docs:end


async def seed(oim: Oim, admin_password: str) -> None:
    """OIM's permissions, and one demo organization with its admin, on an empty database. As Java's DataSeeder."""
    existing = {authority["name"] for authority in await oim.auth.roles.list_authorities()}
    created = 0
    for authority in PERMISSION_CATALOG:
        if authority.name not in existing:
            await oim.auth.roles.create_authority(authority)
            created += 1
    if created:
        oim.log.info("Seeded %d authorities into the egradx-auth catalog", created)
    admin = "admin@egradx.com"
    if not await oim.auth.people.user_id_by_username(admin):
        await oim.auth.provisioning.provision_organization("Egradx Consulting Firm", admin, admin_password, "Demo Admin", admin_username=admin)
        oim.log.info("Seeded organization 'Egradx Consulting Firm' with admin %s", admin)
