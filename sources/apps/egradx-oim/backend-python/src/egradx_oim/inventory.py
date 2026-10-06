"""/v1/inventory, as Java's InventoryController and InventoryService."""

import re
import uuid
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .http import (
    Integer,
    RequestRecord,
    Text,
    Uuid,
    between,
    bind,
    business,
    caller,
    conflict,
    empty,
    insufficient_inventory,
    invalid_request,
    local_date_time,
    local_now,
    max_length,
    not_found,
    not_null,
    ok,
    order_by,
    page,
    pageable,
    plain,
    positive,
    query_param,
    invalid_value,
    uuid_param,
)
from .models import Inventory, Product, Warehouse
from .oim import AuditActions, Oim, OimNotifications, Permissions, audit, organization_of, reading, transaction

LOW_STOCK_THRESHOLD = 10
COLUMNS = {"id": Inventory.id, "organizationId": Inventory.organization_id, "warehouseId": Inventory.warehouse_id, "productId": Inventory.product_id,
           "availableQuantity": Inventory.available_quantity, "reservedQuantity": Inventory.reserved_quantity, "version": Inventory.version,
           "createdAt": Inventory.created_at, "updatedAt": Inventory.updated_at}


def inventory_response(i: Inventory) -> dict[str, Any]:
    """As Java's InventoryResponse."""
    return {"id": i.id, "warehouseId": i.warehouse_id, "productId": i.product_id, "availableQuantity": i.available_quantity,
            "reservedQuantity": i.reserved_quantity, "totalQuantity": i.available_quantity + i.reserved_quantity, "version": i.version,
            "updatedAt": local_date_time(i.updated_at)}


def _signed_64(hex_text: str) -> int:
    value = int(hex_text, 16)
    return value - (1 << 64) if value >= 1 << 63 else value


def java_uuid_key(value: str) -> tuple[int, int]:
    """Java's UUID.compareTo order: the two halves compared as signed 64-bit numbers (not PostgreSQL's byte order)."""
    hex_text = value.replace("-", "")
    return _signed_64(hex_text[:16]), _signed_64(hex_text[16:])


# The stock movements, as Java's InventoryRepository's bulk updates: each changes the row only if the stock allows, and
# (being bulk updates) leaves its version and updated_at as they were.
# docs:region stock-moves
_MOVES = {
    "reserve": """UPDATE inventory SET available_quantity = available_quantity - :q, reserved_quantity = reserved_quantity + :q
        WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org AS uuid) AND available_quantity >= :q""",
    "release": """UPDATE inventory SET available_quantity = available_quantity + :q, reserved_quantity = reserved_quantity - :q
        WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org AS uuid) AND reserved_quantity >= :q""",
    "consume_reserved": """UPDATE inventory SET reserved_quantity = reserved_quantity - :q
        WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org AS uuid) AND reserved_quantity >= :q""",
    "add": "UPDATE inventory SET available_quantity = available_quantity + :q WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org AS uuid)",
    "subtract": """UPDATE inventory SET available_quantity = available_quantity - :q
        WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org AS uuid) AND available_quantity >= :q""",
}
# docs:end


async def move(session: AsyncSession, kind: str, inventory_id: str, organization_id: str, quantity: int) -> int:
    return (await session.execute(text(_MOVES[kind]), {"id": inventory_id, "org": organization_id, "q": quantity})).rowcount


async def fresh_inventory(session: AsyncSession, *where: Any) -> Inventory | None:
    """A row as it is now, after bulk updates the session did not see."""
    return (await session.execute(select(Inventory).where(*where).execution_options(populate_existing=True))).scalar()


def crosses_below_threshold(available_after: int, decrease: int) -> bool:
    """Whether this decrease took the stock from at or above the threshold to below it: the one moment an alert is due."""
    return available_after < LOW_STOCK_THRESHOLD <= available_after + decrease


class InventoryOperations:
    """The operations orders share with the inventory endpoints. As Java's InventoryService."""

    def __init__(self, oim: Oim) -> None:
        self._oim = oim
        self.notifications = OimNotifications(oim)

    async def reserve(self, session: AsyncSession, organization_id: str, inventory_id: str, quantity: int) -> None:
        if await move(session, "reserve", inventory_id, organization_id, quantity) == 0:
            raise insufficient_inventory("Requested quantity is unavailable")
        inventory = await fresh_inventory(session, Inventory.id == inventory_id, Inventory.organization_id == organization_id)
        if inventory is not None:
            await self.notify_if_low_stock_crossed(organization_id, inventory, quantity)
        self._oim.dashboard.evict(organization_id)

    async def release(self, session: AsyncSession, organization_id: str, inventory_id: str, quantity: int) -> None:
        if await move(session, "release", inventory_id, organization_id, quantity) == 0:
            raise conflict("Failed to release inventory - insufficient reserved quantity")
        self._oim.dashboard.evict(organization_id)

    async def consume_reserved(self, session: AsyncSession, organization_id: str, inventory_id: str, quantity: int) -> None:
        if await move(session, "consume_reserved", inventory_id, organization_id, quantity) == 0:
            raise conflict("Failed to consume reservation - insufficient reserved quantity")

    async def notify_if_low_stock_crossed(self, organization_id: str, inventory: Inventory, decrease: int) -> None:
        if crosses_below_threshold(inventory.available_quantity, decrease):
            await self.notifications.inventory_low(organization_id, inventory.id, inventory.product_id, inventory.warehouse_id,
                                                   inventory.available_quantity, LOW_STOCK_THRESHOLD)


def _positive_quantity(request: Request) -> int:
    """A required positive Integer query parameter, as the Java controller's @RequestParam @NotNull @Positive."""
    values = request.query_params.getlist("quantity")
    value = values[0] if values else ""
    # A missing parameter is 400, as Spring means it to be.
    if value == "":
        raise invalid_request("Required request parameter 'quantity' for method parameter type Integer is not present")
    if not re.fullmatch(r"-?\d+", value.strip()):
        raise invalid_value("quantity", value)
    quantity = int(value)
    if not quantity > 0:
        raise invalid_request("Quantity must be positive")
    return quantity


def _required_uuid_query(request: Request, name: str) -> str:
    value = query_param(request, name, "uuid")
    if value is None:
        raise invalid_request(f"Required request parameter '{name}' for method parameter type UUID is not present")
    return value


class CreateInventoryRequest(RequestRecord):
    warehouseId: Uuid(not_null("Warehouse ID is required")) = None  # noqa: N815 - the JSON field's name
    productId: Uuid(not_null("Product ID is required")) = None  # noqa: N815
    quantity: Integer(not_null("Quantity is required"), positive("Quantity must be positive")) = None


class AdjustInventoryRequest(RequestRecord):
    inventoryId: Uuid(not_null("Inventory ID is required")) = None  # noqa: N815
    quantity: Integer(not_null("Quantity is required"), between(-10000, 10000, "Quantity adjustment must be between -10000 and 10000")) = None
    reason: Text(max_length(500, "Reason must not exceed 500 characters")) = None


class TransferRequest(RequestRecord):
    productId: Uuid(not_null("Product ID is required")) = None  # noqa: N815
    sourceWarehouseId: Uuid(not_null("Source Warehouse ID is required")) = None  # noqa: N815
    destinationWarehouseId: Uuid(not_null("Destination Warehouse ID is required")) = None  # noqa: N815
    quantity: Integer(not_null("Quantity is required"), positive("Quantity must be positive")) = None


def inventory_routes(oim: Oim, operations: InventoryOperations, router: APIRouter) -> None:
    async def require(session: AsyncSession, inventory_id: str, organization_id: str) -> Inventory:
        inventory = await fresh_inventory(session, Inventory.id == inventory_id, Inventory.organization_id == organization_id)
        if inventory is None:
            raise not_found("Inventory not found")
        return inventory

    async def exists(session: AsyncSession, model: Any, entity_id: str, organization_id: str) -> bool:
        return (await session.execute(select(model).where(model.id == entity_id, model.organization_id == organization_id))).scalar() is not None

    @business
    async def create(request: Request) -> Response:
        caller()
        body = await bind(request, CreateInventoryRequest)
        organization_id = organization_of(caller(Permissions.INVENTORY_UPDATE))
        async with transaction(oim.engine) as session:
            if not await exists(session, Warehouse, body.warehouseId, organization_id):
                raise not_found("Warehouse not found")
            if not await exists(session, Product, body.productId, organization_id):
                raise not_found("Product not found")
            if await fresh_inventory(session, Inventory.organization_id == organization_id, Inventory.warehouse_id == body.warehouseId,
                                     Inventory.product_id == body.productId) is not None:
                raise conflict("Inventory already exists for this warehouse and product")
            now = local_now()
            saved = Inventory(id=str(uuid.uuid4()), organization_id=organization_id, warehouse_id=body.warehouseId, product_id=body.productId,
                              available_quantity=body.quantity, reserved_quantity=0, version=0, created_at=now, updated_at=now)
            session.add(saved)
            await session.flush()
            result = inventory_response(saved)
            await oim.auditor.record(audit(AuditActions.INVENTORY_CREATED).organization(organization_id).entity("inventory", saved.id)
                                     .after(plain(result)).build())
            oim.dashboard.evict(organization_id)
        return ok(result)

    @business
    async def get(request: Request) -> Response:
        caller()
        inventory_id = uuid_param(request, "id")
        organization_id = organization_of(caller(Permissions.INVENTORY_READ))
        async with reading(oim.engine) as session:
            return ok(inventory_response(await require(session, inventory_id, organization_id)))

    @business
    async def list_(request: Request) -> Response:
        caller()
        warehouse_id = query_param(request, "warehouseId", "uuid")
        product_id = query_param(request, "productId", "uuid")
        paging = pageable(request)
        organization_id = organization_of(caller(Permissions.INVENTORY_READ))
        where = [Inventory.organization_id == organization_id]
        if warehouse_id:
            where.append(Inventory.warehouse_id == warehouse_id)
        elif product_id:
            where.append(Inventory.product_id == product_id)
        ordering = order_by(paging, "Inventory", COLUMNS)
        async with reading(oim.engine) as session:
            rows = (await session.execute(select(Inventory).where(*where).order_by(*ordering).offset(paging.page * paging.size).limit(paging.size))).scalars()
            content = [inventory_response(i) for i in rows]
            total = (await session.execute(select(func.count()).select_from(Inventory).where(*where))).scalar_one()
        return ok(page(content, total, paging))

    @business
    async def adjust(request: Request) -> Response:
        caller()
        body = await bind(request, AdjustInventoryRequest)
        organization_id = organization_of(caller(Permissions.INVENTORY_UPDATE))
        async with transaction(oim.engine) as session:
            before = inventory_response(await require(session, body.inventoryId, organization_id))
            affected = (await move(session, "add", body.inventoryId, organization_id, body.quantity) if body.quantity >= 0
                        else await move(session, "subtract", body.inventoryId, organization_id, -body.quantity))
            if affected == 0:
                raise insufficient_inventory("Insufficient inventory for adjustment")
            saved = await require(session, body.inventoryId, organization_id)
            result = inventory_response(saved)
            await oim.auditor.record(audit(AuditActions.INVENTORY_ADJUSTED).organization(organization_id).entity("inventory", saved.id)
                                     .before(plain(before)).after(plain(result)).build())
            await operations.notifications.inventory_updated(organization_id, result)
            await operations.notify_if_low_stock_crossed(organization_id, saved, -body.quantity)
            oim.dashboard.evict(organization_id)
        return ok(result)

    @business
    async def transfer(request: Request) -> Response:
        caller()
        body = await bind(request, TransferRequest)
        organization_id = organization_of(caller(Permissions.INVENTORY_UPDATE))
        async with transaction(oim.engine) as session:
            if body.sourceWarehouseId == body.destinationWarehouseId:
                raise conflict("Source and destination warehouses cannot be the same")
            if not await exists(session, Warehouse, body.sourceWarehouseId, organization_id):
                raise not_found("Source warehouse not found")
            if not await exists(session, Warehouse, body.destinationWarehouseId, organization_id):
                raise not_found("Destination warehouse not found")
            if not await exists(session, Product, body.productId, organization_id):
                raise not_found("Product not found")
            source = await fresh_inventory(session, Inventory.organization_id == organization_id, Inventory.warehouse_id == body.sourceWarehouseId,
                                           Inventory.product_id == body.productId)
            if source is None:
                raise not_found("Source inventory not found")
            destination = await fresh_inventory(session, Inventory.organization_id == organization_id, Inventory.warehouse_id == body.destinationWarehouseId,
                                                Inventory.product_id == body.productId)

            async def debit() -> None:
                if await move(session, "subtract", source.id, organization_id, body.quantity) == 0:
                    raise insufficient_inventory("Insufficient inventory in source warehouse")

            async def credit() -> None:
                if destination is None:
                    now = local_now()
                    session.add(Inventory(id=str(uuid.uuid4()), organization_id=organization_id, warehouse_id=body.destinationWarehouseId,
                                          product_id=body.productId, available_quantity=body.quantity, reserved_quantity=0, version=0, created_at=now,
                                          updated_at=now))
                    await session.flush()
                else:
                    await move(session, "add", destination.id, organization_id, body.quantity)

            # docs:region transfer-lock-order
            # The rows in one order (Java's), so two opposite transfers can't deadlock.
            if destination is None or java_uuid_key(source.id) <= java_uuid_key(destination.id):
                await debit()
                await credit()
            else:
                await credit()
                await debit()
            # docs:end
            refreshed = await fresh_inventory(session, Inventory.id == source.id, Inventory.organization_id == organization_id) or source
            await oim.auditor.record(audit(AuditActions.INVENTORY_TRANSFERRED).organization(organization_id).entity("inventory", source.id)
                                     .detail("productId", body.productId).detail("fromWarehouseId", body.sourceWarehouseId)
                                     .detail("toWarehouseId", body.destinationWarehouseId).detail("quantity", body.quantity).build())
            await operations.notifications.inventory_transferred(organization_id, body.productId, body.sourceWarehouseId, body.destinationWarehouseId,
                                                                 body.quantity)
            await operations.notify_if_low_stock_crossed(organization_id, refreshed, body.quantity)
            oim.dashboard.evict(organization_id)
        return empty()

    @business
    async def reserve(request: Request) -> Response:
        caller()
        inventory_id = _required_uuid_query(request, "inventoryId")
        quantity = _positive_quantity(request)
        organization_id = organization_of(caller(Permissions.INVENTORY_UPDATE))
        async with transaction(oim.engine) as session:
            await operations.reserve(session, organization_id, inventory_id, quantity)
        return empty()

    @business
    async def release(request: Request) -> Response:
        caller()
        inventory_id = _required_uuid_query(request, "inventoryId")
        quantity = _positive_quantity(request)
        organization_id = organization_of(caller(Permissions.INVENTORY_UPDATE))
        async with transaction(oim.engine) as session:
            await operations.release(session, organization_id, inventory_id, quantity)
        return empty()

    router.add_api_route("/v1/inventory", create, methods=["POST"])
    router.add_api_route("/v1/inventory", list_, methods=["GET"])
    router.add_api_route("/v1/inventory/adjust", adjust, methods=["POST"])
    router.add_api_route("/v1/inventory/transfer", transfer, methods=["POST"])
    router.add_api_route("/v1/inventory/reserve", reserve, methods=["POST"])
    router.add_api_route("/v1/inventory/release", release, methods=["POST"])
    router.add_api_route("/v1/inventory/{id}", get, methods=["GET"])
