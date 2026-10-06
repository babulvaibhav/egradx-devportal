import asyncio
import selectors
import sys
from collections.abc import Callable, Mapping

import pytest


def pytest_asyncio_loop_factories(config: pytest.Config, item: pytest.Item) -> Mapping[str, Callable[[], asyncio.AbstractEventLoop]] | None:
    """psycopg's async mode needs a selector event loop, which Windows doesn't use by default."""
    if sys.platform == "win32":
        return {"selector": lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())}
    return None
