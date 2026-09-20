from yomi.shared.capabilities import (
    EXTERNAL_AGENT_CAPABILITIES,
    EXTERNAL_DEFAULT_CAPABILITIES,
    CapabilityEnforcer,
    CapabilityManifest,
    denial_message,
    evaluate_manifest,
    has_capability,
    scope_grants,
)


def test_scope_grants_glob():
    assert scope_grants("memory:*", "memory:read")
    assert scope_grants("profile:read", "profile:read")
    assert not scope_grants("memory:read", "memory:write")
    assert not scope_grants("connector:read", "memory:read")


def test_has_capability():
    assert has_capability(("connector:*",), "connector:execute")
    assert not has_capability(("connector:read",), "connector:write")


def test_default_external_set():
    assert EXTERNAL_DEFAULT_CAPABILITIES == (
        "memory:*",
        "schedule:*",
        "connector:*",
        "profile:read",
    )
    assert not has_capability(EXTERNAL_DEFAULT_CAPABILITIES, "agent:execute")


def test_agent_set_includes_execute():
    assert has_capability(EXTERNAL_AGENT_CAPABILITIES, "agent:execute")


def test_enforcer():
    enforcer = CapabilityEnforcer(("memory:read",))
    assert enforcer.allows("memory:read")
    assert not enforcer.allows("memory:write")
    check = enforcer.check("memory:write")
    assert check["allowed"] is False
    assert check["missing"] == "memory:write"


def test_denial_message():
    msg = denial_message("memory:write")
    assert '"memory:write"' in msg


def test_evaluate_manifest():
    manifest = CapabilityManifest(
        required=["memory:read"], optional=["agent:execute"], permissions=[]
    )
    ok = evaluate_manifest(manifest, ("memory:read",))
    assert ok.satisfied
    assert ok.missing_optional == ["agent:execute"]

    bad = evaluate_manifest(
        CapabilityManifest(["connector:read"], ["agent:execute"], []), ("memory:read",)
    )
    assert not bad.satisfied
    assert bad.missing == ["connector:read"]
    assert bad.missing_optional == ["agent:execute"]