"""The OIM backend's HTTP surface, under /api as the Java one serves it: the SDK's endpoints (auth, audit, notifications)
and OIM's own under /api/v1. Business routes answer in the Java backend's error envelope."""

from collections.abc import Callable

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match

from egradx.sdk.fastapi import egradx_router, install_egradx

from .config import Config
from .telemetry import PROMETHEUS_CONTENT_TYPE
from .customers import customer_routes
from .dashboard import dashboard_routes
from .http import Cors, SignedInOrOpen, oim_error, unmatched
from .inventory import InventoryOperations, inventory_routes
from .oim import Oim
from .orders import order_routes
from .products import product_routes
from .warehouses import warehouse_routes


def oim_app(oim: Oim, config: Config, prometheus: Callable[[], bytes] | None = None) -> FastAPI:
    """``prometheus``: what /api/actuator/prometheus serves, when telemetry runs (telemetry.py)."""
    api = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "UP"})

    async def info(_request: Request) -> Response:
        return JSONResponse({})

    api.add_api_route("/actuator/health", health, methods=["GET"])
    api.add_api_route("/actuator/info", info, methods=["GET"])
    if prometheus is not None:
        async def scrape(_request: Request) -> Response:
            # What Prometheus scrapes, at the Java backend's path (observability/prometheus.yml).
            return Response(prometheus(), media_type=PROMETHEUS_CONTENT_TYPE)

        api.add_api_route("/actuator/prometheus", scrape, methods=["GET"])
    api.include_router(egradx_router(oim, max_page_size=config.page_max_size))

    business = APIRouter()
    inventory = InventoryOperations(oim)
    product_routes(oim, business)
    warehouse_routes(oim, business)
    customer_routes(oim, business)
    inventory_routes(oim, inventory, business)
    order_routes(oim, inventory, business)
    dashboard_routes(oim, business)
    api.include_router(business)

    # Innermost first: the gate and CORS run inside EgradxMiddleware, which sets the request's context and caller.
    # docs:region identity-chain
    api.add_middleware(SignedInOrOpen)
    api.add_middleware(Cors, origins=config.cors_origins)
    install_egradx(api, verifier=oim.auth.verifier, resolve=oim.auth.resolve_caller)
    # docs:end

    async def no_route(request: Request, error: StarletteHTTPException) -> Response:
        if error.status_code == 405:
            # Every method the path takes, as Spring lists them, not only the first route's.
            allowed = sorted({method for route in api.router.routes if route.matches(request.scope)[0] == Match.PARTIAL
                              for method in getattr(route, "methods", ()) or ()})
            return oim_error(405, "INVALID_REQUEST", f"Request method '{request.method}' is not supported", headers={"Allow": ", ".join(allowed)})
        return await unmatched(request, error)

    # What no route answers is the Java backend's envelope, for the SDK's paths as for OIM's.
    api.add_exception_handler(StarletteHTTPException, no_route)  # type: ignore[arg-type]

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    app.mount(config.context_path, api)
    return app
