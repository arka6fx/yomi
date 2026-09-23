"""Connectors: durable tool sets the agent can call for a user.

Public surface: `ConnectorRegistry`, `ALL_CONNECTOR_DEFS`, and the risk/error
primitives in `base.py`. Connector modules provide `{connector}_def` plus raw
pure helpers for unit testing.
"""

from yomi.connectors.base import (
    IRREVERSIBLE,
    PAID,
    SEND,
    WRITE,
    ConnectorContext,
    ConnectorDef,
    ConnectorError,
    ConnectorTool,
    connector_error,
    gate_write,
)
from yomi.connectors.registry import ALL_CONNECTOR_DEFS, ConnectorRegistry

__all__ = [
    "ALL_CONNECTOR_DEFS",
    "ConnectorRegistry",
    "IRREVERSIBLE",
    "PAID",
    "SEND",
    "WRITE",
    "ConnectorContext",
    "ConnectorDef",
    "ConnectorError",
    "ConnectorTool",
    "connector_error",
    "gate_write",
]