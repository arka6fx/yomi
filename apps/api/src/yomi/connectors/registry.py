"""Connector registry: which defs ship, which ones a user has connected.

The agent host builds this per user and hands the resulting tool map to the LLM.
Only providers with a row in `mcp_connections` surface their tools — a user who
has not connected a provider simply does not see those tools. Live tokens are
resolved through `token_provider(db)`; pending writes through an optional
`create_pending_action` callable.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.connectors.base import ConnectorContext, ConnectorDef, ConnectorTool
from yomi.connectors.calendar import google_calendar_def
from yomi.connectors.drive import google_drive_def
from yomi.connectors.gmail import google_gmail_def
from yomi.connectors.tokens import _is_uuid, token_provider
from yomi.db.models_app2 import McpConnection

ALL_CONNECTOR_DEFS: tuple[ConnectorDef, ...] = (
    google_gmail_def,
    google_calendar_def,
    google_drive_def,
)


@dataclass
class ConnectorRegistry:
    """Holds the known connector defs and builds per-user tool sets."""

    defs: tuple[ConnectorDef, ...] = field(default=ALL_CONNECTOR_DEFS)
    _by_id: dict[str, ConnectorDef] = field(init=False)

    def __post_init__(self) -> None:
        self._by_id = {adef.id: adef for adef in self.defs}

    def def_for(self, connector_id: str) -> ConnectorDef | None:
        return self._by_id.get(connector_id)

    async def connected(self, db: AsyncSession, user_id: str) -> set[str]:
        if not _is_uuid(user_id):
            # mcp_connections.user_id is a uuid column; arbitrary ids never match.
            return set()
        rows = (
            await db.execute(
                select(McpConnection.provider).where(McpConnection.user_id == user_id)
            )
        ).scalars()
        return set(rows)

    async def tools_for_user(
        self,
        db: AsyncSession,
        user_id: str,
        create_pending_action: Callable[[dict], Awaitable[dict]] | None = None,
    ) -> dict[str, ConnectorTool]:
        connected = await self.connected(db, user_id)
        ctx = ConnectorContext(
            user_id=user_id,
            get_access_token=token_provider(db),
            create_pending_action=create_pending_action,
        )
        tools: dict[str, ConnectorTool] = {}
        for connector_id in connected:
            adef = self._by_id.get(connector_id)
            if adef is None:
                continue
            tools.update(adef.tools(ctx))
        return tools


default_registry = ConnectorRegistry()