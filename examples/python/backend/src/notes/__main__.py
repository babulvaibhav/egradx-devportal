"""Runs Notes: `uv run python -m notes`."""

import asyncio
import logging
import os
import selectors
import sys

import uvicorn
from egradx.sdk import CORRELATION_FORMAT, install_log_correlation

from .common.telemetry import instrument, start_telemetry

start_telemetry("notes")  # before the application is built, so everything it creates is instrumented
from .app import Application  # noqa: E402
from .config import from_environment  # noqa: E402


# docs:region log-correlation
# Every log line carries its trace and request ids.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s " + CORRELATION_FORMAT + "%(name)s - %(message)s")
install_log_correlation()
# docs:end

application = Application(from_environment())
app = instrument(application.app)


# docs:region run
def selector_loop() -> asyncio.AbstractEventLoop:
    """psycopg's async mode needs a selector event loop, which Windows doesn't use by default."""
    return asyncio.SelectorEventLoop(selectors.SelectSelector()) if sys.platform == "win32" else asyncio.new_event_loop()


if __name__ == "__main__":
    server = uvicorn.Server(uvicorn.Config(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")), loop="none"))
    asyncio.run(server.serve(), loop_factory=selector_loop)
# docs:end
