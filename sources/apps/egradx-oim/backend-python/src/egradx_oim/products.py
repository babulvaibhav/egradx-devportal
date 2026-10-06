"""/v1/products, as Java's ProductController and ProductService."""

import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select

from .http import (
    Enum,
    Number,
    RequestRecord,
    Text,
    bind,
    business,
    caller,
    conflict,
    decimal_min,
    digits,
    empty,
    local_date_time,
    local_now,
    max_length,
    money,
    not_blank,
    not_found,
    not_null,
    ok,
    order_by,
    page,
    pageable,
    plain,
    query_param,
    search_param,
    uuid_param,
)
from .models import Product
from .oim import AuditActions, Oim, Permissions, audit, organization_of, reading, transaction

COLUMNS = {"id": Product.id, "organizationId": Product.organization_id, "sku": Product.sku, "name": Product.name, "description": Product.description,
           "price": Product.price, "status": Product.status, "createdAt": Product.created_at, "updatedAt": Product.updated_at}


def product_response(p: Product) -> dict[str, Any]:
    """As Java's ProductResponse."""
    return {"id": p.id, "sku": p.sku, "name": p.name, "description": p.description, "price": money(p.price), "status": p.status,
            "createdAt": local_date_time(p.created_at), "updatedAt": local_date_time(p.updated_at)}


class ProductRequest(RequestRecord):
    sku: Text(not_blank("SKU is required"), max_length(50, "SKU must not exceed 50 characters")) = None
    name: Text(not_blank("Name is required"), max_length(200, "Name must not exceed 200 characters")) = None
    description: Text(max_length(1000, "Description must not exceed 1000 characters")) = None
    price: Number(not_null("Price is required"), decimal_min("0.01", "Price must be greater than 0"),
                  digits(8, 2, "Price must have at most 8 integer digits and 2 decimal digits")) = None
    status: Enum("ACTIVE|DISABLED") = None


def changed(entity: Any, changes: dict[str, Any]) -> bool:
    """As Hibernate's dirty checking: whether any value differs (a decimal by value, not by scale)."""
    return any(getattr(entity, key) != value for key, value in changes.items())


def save_if_changed(entity: Any, changes: dict[str, Any]) -> None:
    """Written, with a new updated_at, only if something changed."""
    if changed(entity, changes):
        for key, value in changes.items():
            setattr(entity, key, value)
        entity.updated_at = local_now()


def product_routes(oim: Oim, router: APIRouter) -> None:
    # docs:region create-product (apps/egradx-devportal shows this)
    @business
    async def create(request: Request) -> Response:
        caller()
        body = await bind(request, ProductRequest)
        organization_id = organization_of(caller(Permissions.PRODUCT_WRITE))
        async with transaction(oim.engine) as session:
            taken = (await session.execute(select(Product).where(Product.organization_id == organization_id, Product.sku == body.sku))).scalar()
            if taken is not None:
                raise conflict(f"Product with SKU {body.sku} already exists in this organization")
            now = local_now()
            saved = Product(id=str(uuid.uuid4()), organization_id=organization_id, sku=body.sku, name=body.name, description=body.description,
                            price=Decimal(body.price), status=body.status or "ACTIVE", created_at=now, updated_at=now)
            session.add(saved)
            await session.flush()
            result = product_response(saved)
            await oim.auditor.record(audit(AuditActions.PRODUCT_CREATED).organization(organization_id).entity("product", saved.id, saved.name)
                                     .after(plain(result)).build())
            oim.dashboard.evict(organization_id)
        return ok(result)
    # docs:end

    @business
    async def get(request: Request) -> Response:
        caller()
        product_id = uuid_param(request, "id")
        organization_id = organization_of(caller(Permissions.PRODUCT_READ))
        async with reading(oim.engine) as session:
            product = (await session.execute(select(Product).where(Product.id == product_id, Product.organization_id == organization_id))).scalar()
        if product is None:
            raise not_found("Product not found")
        return ok(product_response(product))

    @business
    async def list_(request: Request) -> Response:
        caller()
        search = search_param(request)
        status = query_param(request, "status", "enum:ACTIVE|DISABLED")
        paging = pageable(request)
        organization_id = organization_of(caller(Permissions.PRODUCT_READ))
        where = [Product.organization_id == organization_id]
        if search:
            where.append(or_(Product.name.ilike(f"%{search}%"), Product.sku.ilike(f"%{search}%")))
        elif status:
            where.append(Product.status == status)
        ordering = order_by(paging, "Product", COLUMNS)
        async with reading(oim.engine) as session:
            rows = (await session.execute(select(Product).where(*where).order_by(*ordering).offset(paging.page * paging.size).limit(paging.size))).scalars()
            content = [product_response(p) for p in rows]
            total = (await session.execute(select(func.count()).select_from(Product).where(*where))).scalar_one()
        return ok(page(content, total, paging))

    @business
    async def update(request: Request) -> Response:
        caller()
        product_id = uuid_param(request, "id")
        body = await bind(request, ProductRequest)
        organization_id = organization_of(caller(Permissions.PRODUCT_WRITE))
        async with transaction(oim.engine) as session:
            product = (await session.execute(select(Product).where(Product.id == product_id, Product.organization_id == organization_id))).scalar()
            if product is None:
                raise not_found("Product not found")
            if product.sku != body.sku and (await session.execute(select(Product).where(Product.organization_id == organization_id,
                                                                                        Product.sku == body.sku))).scalar() is not None:
                raise conflict(f"Product with SKU {body.sku} already exists in this organization")
            # docs:region update-product-audit
            before = product_response(product)
            save_if_changed(product, {"sku": body.sku, "name": body.name, "description": body.description, "price": Decimal(body.price),
                                      "status": body.status or product.status})
            await session.flush()
            result = product_response(product)
            await oim.auditor.record(audit(AuditActions.PRODUCT_UPDATED).organization(organization_id).entity("product", product.id, product.name)
                                     .before(plain(before)).after(plain(result)).build())
            oim.dashboard.evict(organization_id)
            # docs:end
        return ok(result)

    @business
    async def disable(request: Request) -> Response:
        caller()
        product_id = uuid_param(request, "id")
        organization_id = organization_of(caller(Permissions.PRODUCT_WRITE))
        async with transaction(oim.engine) as session:
            product = (await session.execute(select(Product).where(Product.id == product_id, Product.organization_id == organization_id))).scalar()
            if product is None:
                raise not_found("Product not found")
            before = product_response(product)
            save_if_changed(product, {"status": "DISABLED"})
            await session.flush()
            await oim.auditor.record(audit(AuditActions.PRODUCT_DISABLED).organization(organization_id).entity("product", product_id, product.name)
                                     .before(plain(before)).after(plain(product_response(product))).build())
            oim.dashboard.evict(organization_id)
        return empty()

    router.add_api_route("/v1/products", create, methods=["POST"])
    router.add_api_route("/v1/products", list_, methods=["GET"])
    router.add_api_route("/v1/products/{id}", get, methods=["GET"])
    router.add_api_route("/v1/products/{id}", update, methods=["PATCH"])
    router.add_api_route("/v1/products/{id}/disable", disable, methods=["PATCH"])
