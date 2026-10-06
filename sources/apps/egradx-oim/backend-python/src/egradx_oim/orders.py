"""/v1/orders, as Java's OrderController and OrderService."""

import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select, text

from .http import (
    Array,
    Enum,
    Integer,
    OimError,
    unreadable_body,
    RequestRecord,
    Text,
    Uuid,
    access_denied,
    bind,
    bind_object,
    business,
    caller,
    conflict,
    insufficient_inventory,
    invalid_request,
    invalid_transition,
    local_date_time,
    local_now,
    max_length,
    money,
    not_empty,
    not_found,
    not_null,
    ok,
    order_by,
    page,
    pageable,
    plain,
    positive,
    query_param,
    search_param,
    uuid_param,
)
from .inventory import InventoryOperations, fresh_inventory, java_uuid_key
from .models import Customer, Inventory, Order, OrderItem, Product
from .oim import AuditActions, Oim, Permissions, audit, organization_of, reading, transaction

STATUSES = "PENDING|CONFIRMED|PROCESSING|COMPLETED|CANCELLED"
COLUMNS = {"id": Order.id, "organizationId": Order.organization_id, "customerId": Order.customer_id, "status": Order.status,
           "totalAmount": Order.total_amount, "notes": Order.notes, "createdAt": Order.created_at, "updatedAt": Order.updated_at}


def order_response(o: Order, items: list[OrderItem] | None = None) -> dict[str, Any]:
    """As Java's OrderResponse and OrderItemResponse."""
    return {"id": o.id, "customerId": o.customer_id, "status": o.status, "totalAmount": money(o.total_amount), "notes": o.notes,
            "createdAt": local_date_time(o.created_at), "updatedAt": local_date_time(o.updated_at),
            "items": [{"id": i.id, "productId": i.product_id, "quantity": i.quantity, "unitPrice": money(i.unit_price), "totalPrice": money(i.total_price),
                       "warehouseId": i.warehouse_id} for i in (o.items if items is None else items)]}


def _valid_transition(current: str, next_status: str) -> bool:
    """The only moves an order may make."""
    return next_status in {"PENDING": ("CONFIRMED", "CANCELLED"), "CONFIRMED": ("PROCESSING", "CANCELLED"), "PROCESSING": ("COMPLETED",)}.get(current, ())


class CreateOrderRequest(RequestRecord):
    customerId: Uuid(not_null("Customer ID is required")) = None  # noqa: N815 - the JSON field's name
    items: Array(not_empty("Order items are required")) = None
    notes: Text(max_length(1000, "Notes must not exceed 1000 characters")) = None


class OrderItemRequest(RequestRecord):
    productId: Uuid(not_null("Product ID is required")) = None  # noqa: N815
    quantity: Integer(not_null("Quantity is required"), positive("Quantity must be positive")) = None
    warehouseId: Uuid(not_null("Warehouse ID is required")) = None  # noqa: N815


class StatusRequest(RequestRecord):
    status: Enum(STATUSES, not_null("Status is required")) = None


def order_routes(oim: Oim, inventory: InventoryOperations, router: APIRouter) -> None:
    async def find(session: Any, order_id: str, organization_id: str) -> Order | None:
        return (await session.execute(select(Order).where(Order.id == order_id, Order.organization_id == organization_id)
                                      .execution_options(populate_existing=True))).scalar()

    @business
    async def create(request: Request) -> Response:
        caller()
        body = await bind(request, CreateOrderRequest)
        # @Valid on the items: each is bound and checked as its own record.
        items: list[OrderItemRequest] = []
        messages: list[str] = []
        for raw in body.items:
            if not isinstance(raw, dict):
                raise unreadable_body()
            try:
                items.append(bind_object(OrderItemRequest, raw))
            except OimError as error:
                if error.code != "INVALID_REQUEST":
                    raise
                messages.append(error.message)
        if messages:
            raise invalid_request(", ".join(messages))
        organization_id = organization_of(caller(Permissions.ORDER_CREATE))
        async with transaction(oim.engine) as session:
            customer = (await session.execute(select(Customer).where(Customer.id == body.customerId, Customer.organization_id == organization_id))).scalar()
            if customer is None:
                raise not_found("Customer not found")
            products: dict[str, Product] = {}
            for product_id in dict.fromkeys(item.productId for item in items):
                product = (await session.execute(select(Product).where(Product.id == product_id, Product.organization_id == organization_id))).scalar()
                if product is None:
                    raise not_found(f"Product not found: {product_id}")
                products[product_id] = product
            disabled = next((p for p in products.values() if p.status == "DISABLED"), None)
            if disabled is not None:
                raise conflict(f'Product "{disabled.name}" is disabled and cannot be ordered')
            lines: list[tuple[str, OrderItemRequest]] = []
            for item in items:
                stock = await fresh_inventory(session, Inventory.organization_id == organization_id, Inventory.warehouse_id == item.warehouseId,
                                              Inventory.product_id == item.productId)
                if stock is None:
                    raise not_found("Inventory not found for warehouse and product")
                lines.append((stock.id, item))
            # Reserved in one order (Java's UUID order), so concurrent orders can't deadlock.
            lines.sort(key=lambda line: java_uuid_key(line[0]))
            total = Decimal(0)
            order_items: list[OrderItem] = []
            for inventory_id, item in lines:
                try:
                    await inventory.reserve(session, organization_id, inventory_id, item.quantity)
                except OimError as error:
                    if error.code == "INSUFFICIENT_INVENTORY":
                        raise insufficient_inventory(f"INSUFFICIENT_INVENTORY for product: {item.productId}") from None
                    raise
                unit_price = products[item.productId].price
                total_price = unit_price * item.quantity
                order_items.append(OrderItem(id=str(uuid.uuid4()), product_id=item.productId, quantity=item.quantity, unit_price=unit_price,
                                             total_price=total_price, warehouse_id=item.warehouseId))
                total += total_price
            now = local_now()
            saved = Order(id=str(uuid.uuid4()), organization_id=organization_id, customer_id=customer.id, status="PENDING", total_amount=total,
                          notes=body.notes, created_at=now, updated_at=now, items=list(order_items))
            session.add(saved)
            await session.flush()
            # In reservation order, as the Java backend returns the order it just made.
            result = order_response(saved, order_items)
            await oim.auditor.record(audit(AuditActions.ORDER_CREATED).organization(organization_id).entity("order", saved.id).after(plain(result)).build())
            await inventory.notifications.order_created(organization_id, saved.id, saved.customer_id, saved.status, f"{saved.total_amount:.2f}",
                                                        len(order_items))
            oim.dashboard.evict(organization_id)
        return ok(result)

    @business
    async def get(request: Request) -> Response:
        caller()
        order_id = uuid_param(request, "id")
        organization_id = organization_of(caller(Permissions.ORDER_READ))
        async with reading(oim.engine) as session:
            order = await find(session, order_id, organization_id)
            if order is None:
                raise not_found("Order not found")
            return ok(order_response(order))

    @business
    async def list_(request: Request) -> Response:
        caller()
        search = search_param(request)
        status = query_param(request, "status", f"enum:{STATUSES}")
        paging = pageable(request)
        organization_id = organization_of(caller(Permissions.ORDER_READ))
        where = [Order.organization_id == organization_id]
        if search:
            # As Java's query: orders whose customer's name or email contains the text.
            customers = select(Customer.id).where(or_(Customer.name.ilike(f"%{search}%"), Customer.email.ilike(f"%{search}%")))
            where.append(Order.customer_id.in_(customers))
        elif status:
            where.append(Order.status == status)
        ordering = order_by(paging, "Order", COLUMNS)
        async with reading(oim.engine) as session:
            rows = (await session.execute(select(Order).where(*where).order_by(*ordering).offset(paging.page * paging.size).limit(paging.size))).scalars()
            content = [order_response(o) for o in rows]
            total = (await session.execute(select(func.count()).select_from(Order).where(*where))).scalar_one()
        return ok(page(content, total, paging))

    @business
    async def change_status(request: Request) -> Response:
        caller()
        order_id = uuid_param(request, "id")
        body = await bind(request, StatusRequest)
        me = caller(Permissions.ORDER_CREATE, Permissions.ORDER_CANCEL)
        organization_id = organization_of(me)
        next_status = body.status
        async with transaction(oim.engine) as session:
            order = await find(session, order_id, organization_id)
            if order is None:
                raise not_found("Order not found")
            current = order.status
            if not _valid_transition(current, next_status):
                raise invalid_transition(f"Invalid status transition from {current} to {next_status}")
            required = Permissions.ORDER_CANCEL if next_status == "CANCELLED" else Permissions.ORDER_CREATE
            if required not in me.authorities:
                raise access_denied(f"Missing permission: {required}")
            before = order_response(order)
            # docs:region order-status-cas
            # A bulk update, as Java's: the status only if it is still what was read, and updated_at untouched.
            updated = (await session.execute(text("""UPDATE orders SET status = :next WHERE id = CAST(:id AS uuid)
                AND organization_id = CAST(:org AS uuid) AND status = :current"""), {"id": order_id, "org": organization_id, "current": current,
                                                                                     "next": next_status})).rowcount
            if updated == 0:
                raise invalid_transition(f"Order status changed concurrently — expected {current}, please retry")
            # docs:end
            for item in list(order.items):
                if item.warehouse_id is None:
                    continue
                stock = await fresh_inventory(session, Inventory.organization_id == organization_id, Inventory.warehouse_id == item.warehouse_id,
                                              Inventory.product_id == item.product_id)
                if stock is not None and next_status == "CANCELLED":
                    await inventory.release(session, organization_id, stock.id, item.quantity)
                elif stock is not None and next_status == "COMPLETED":
                    await inventory.consume_reserved(session, organization_id, stock.id, item.quantity)
            saved = await find(session, order_id, organization_id)
            result = order_response(saved)
            await oim.auditor.record(audit(AuditActions.ORDER_STATUS_CHANGED).organization(organization_id).entity("order", saved.id)
                                     .before(plain(before)).after(plain(result)).detail("from", current).detail("to", next_status).build())
            if next_status == "CANCELLED":
                await inventory.notifications.order_cancelled(organization_id, saved.id, saved.customer_id, f"{saved.total_amount:.2f}")
            oim.dashboard.evict(organization_id)
        return ok(result)

    router.add_api_route("/v1/orders", create, methods=["POST"])
    router.add_api_route("/v1/orders", list_, methods=["GET"])
    router.add_api_route("/v1/orders/{id}", get, methods=["GET"])
    router.add_api_route("/v1/orders/{id}/status", change_status, methods=["PATCH"])

