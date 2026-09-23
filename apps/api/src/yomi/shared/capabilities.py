"""Capability vocabulary + enforcement (ADR-0005).

Port of packages/shared/src/capabilities.ts. Pure — shared by the API and the
connector dispatch layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

CAPABILITY_RESOURCES = ("memory", "schedule", "connector", "agent", "profile", "filesystem")
CAPABILITY_ACTIONS = ("read", "write", "delete", "execute")

Scope: TypeAlias = str
CapabilitySet: TypeAlias = tuple[Scope, ...]

# Default scopes for an authenticated external (MCP/API) caller; deliberately
# withholds agent:execute.
EXTERNAL_DEFAULT_CAPABILITIES: CapabilitySet = (
    "memory:*",
    "schedule:*",
    "connector:*",
    "profile:read",
)

# Scopes granted to first-party agent runs (Telegram backend agent).
EXTERNAL_AGENT_CAPABILITIES: CapabilitySet = (
    "memory:*",
    "schedule:*",
    "connector:*",
    "agent:execute",
    "profile:*",
    "filesystem:*",
)

# Machine-readable denial message for a required scope.
def denial_message(required: Scope) -> str:
    return (
        f'Capability denied: this action requires "{required}", '
        "which the caller has not been granted."
    )


def scope_grants(granted: Scope, required: Scope) -> bool:
    gr, ga = granted.split(":", 1)
    rr, ra = required.split(":", 1)
    return (gr == "*" or gr == rr) and (ga == "*" or ga == ra)


def has_capability(set_: CapabilitySet, required: Scope) -> bool:
    return any(scope_grants(g, required) for g in set_)


class CapabilityEnforcer:
    """Checks granted scopes against a required `resource:action` before a tool runs."""

    def __init__(self, granted: CapabilitySet) -> None:
        self.granted = granted

    def allows(self, required: Scope) -> bool:
        return has_capability(self.granted, required)

    def check(self, required: Scope) -> dict[str, object]:
        if self.allows(required):
            return {"allowed": True}
        return {"allowed": False, "missing": required, "message": denial_message(required)}


@dataclass
class CapabilityManifest:
    required: list[Scope]
    optional: list[Scope]
    permissions: list[str]


@dataclass
class ManifestSatisfaction:
    satisfied: bool
    missing: list[Scope]
    granted_optional: list[Scope]
    missing_optional: list[Scope]


def evaluate_manifest(manifest: CapabilityManifest, granted: CapabilitySet) -> ManifestSatisfaction:
    missing = [s for s in manifest.required if not has_capability(granted, s)]
    granted_optional = [s for s in manifest.optional if has_capability(granted, s)]
    missing_optional = [s for s in manifest.optional if not has_capability(granted, s)]
    return ManifestSatisfaction(
        satisfied=len(missing) == 0,
        missing=missing,
        granted_optional=granted_optional,
        missing_optional=missing_optional,
    )