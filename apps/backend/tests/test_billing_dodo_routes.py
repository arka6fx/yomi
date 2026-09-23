"""Tests for the Dodo Payments route surface (webhook signatures, checkout,
subscription cancel). Uses test-mode env vars and a captured dodo_request."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from types import SimpleNamespace

from fastapi.responses import JSONResponse

from yomi.app.routes import billing as billing_routes


def build_signed_webhook(
    secret: str, body: str, webhook_id: str = "msg_test", timestamp: int | None = None
) -> tuple[bytes, dict[str, str]]:
    ts = str(timestamp or int(time.time()))
    raw = secret[6:] if secret.startswith("whsec_") else secret
    key = base64.b64decode(raw) if secret.startswith("whsec_") else raw.encode()
    digest = hmac.new(key, f"{webhook_id}.{ts}.{body}".encode(), hashlib.sha256).digest()
    headers = {
        "webhook-id": webhook_id,
        "webhook-timestamp": ts,
        "webhook-signature": "v1," + base64.b64encode(digest).decode(),
    }
    return b"", headers


class TestVerifyWebhookSignature:
    async def test_valid_signature_is_accepted(self, monkeypatch) -> None:
        secret = base64.b64encode(b"s" * 16).decode()
        monkeypatch.setenv("DODO_TEST_WEBHOOK_SECRET", f"whsec_{secret}")
        monkeypatch.delenv("DODO_ENV", raising=False)
        body = '{"type":"subscription.active","data":{}}'
        _, headers = build_signed_webhook(f"whsec_{secret}", body)
        assert billing_routes.verify_dodo_webhook(body, headers) is True

    async def test_non_base64_secret_is_used_raw(self, monkeypatch) -> None:
        monkeypatch.setenv("DODO_TEST_WEBHOOK_SECRET", "plain-secret")
        monkeypatch.delenv("DODO_ENV", raising=False)
        body = '{"type":"payment.succeeded","data":{}}'
        _, headers = build_signed_webhook("plain-secret", body)
        assert billing_routes.verify_dodo_webhook(body, headers) is True

    async def test_tampered_body_is_rejected(self, monkeypatch) -> None:
        secret = base64.b64encode(b"k" * 16).decode()
        monkeypatch.setenv("DODO_TEST_WEBHOOK_SECRET", f"whsec_{secret}")
        monkeypatch.delenv("DODO_ENV", raising=False)
        good = '{"type":"subscription.active","data":{}}'
        _, headers = build_signed_webhook(f"whsec_{secret}", good)
        assert billing_routes.verify_dodo_webhook(good + " ", headers) is False

    async def test_missing_secret_is_rejected(self, monkeypatch) -> None:
        monkeypatch.delenv("DODO_TEST_WEBHOOK_SECRET", raising=False)
        monkeypatch.delenv("DODO_ENV", raising=False)
        body = '{"type":"subscription.active"}'
        _, headers = build_signed_webhook("whatever", body)
        assert billing_routes.verify_dodo_webhook(body, headers) is False

    async def test_stale_signature_is_rejected(self, monkeypatch) -> None:
        secret = base64.b64encode(b"t" * 16).decode()
        monkeypatch.setenv("DODO_TEST_WEBHOOK_SECRET", f"whsec_{secret}")
        monkeypatch.delenv("DODO_ENV", raising=False)
        body = '{"type":"subscription.active","data":{}}'
        old = int(time.time()) - 3600
        _, headers = build_signed_webhook(f"whsec_{secret}", body, timestamp=old)
        assert billing_routes.verify_dodo_webhook(body, headers) is False


class TestCancelSubscription:
    async def test_cancel_uses_patch_with_schedule_flag(self, monkeypatch) -> None:
        captured: dict = {}

        async def fake_dodo_request(path: str, body=None, method: str | None = None):
            captured.update(path=path, body=body, method=method)
            return {"ok": True}

        monkeypatch.setattr(billing_routes, "dodo_request", fake_dodo_request)
        user = SimpleNamespace(dodo_subscription_id="sub-42")
        res = await billing_routes.cancel_subscription(session=SimpleNamespace(), user=user)
        assert res == {
            "ok": True,
            "message": "Your subscription will cancel at the end of the billing period.",
        }
        assert captured["path"] == "/subscriptions/sub-42"
        assert captured["method"] == "PATCH"
        assert captured["body"] == {"cancel_at_next_billing_date": True}

    async def test_cancel_without_subscription_returns_404(self, monkeypatch) -> None:
        async def fake_dodo_request(path: str, body=None, method: str | None = None):
            raise AssertionError("should not call Dodo without a subscription")

        monkeypatch.setattr(billing_routes, "dodo_request", fake_dodo_request)
        user = SimpleNamespace(dodo_subscription_id=None)
        res = await billing_routes.cancel_subscription(session=SimpleNamespace(), user=user)
        assert isinstance(res, JSONResponse) and res.status_code == 404


class TestDodoAuth:
    async def test_error_names_the_missing_env(self, monkeypatch) -> None:
        monkeypatch.delenv("DODO_ENV", raising=False)
        monkeypatch.delenv("DODO_LIVE_API_KEY", raising=False)
        monkeypatch.delenv("DODO_TEST_API_KEY", raising=False)
        monkeypatch.delenv("DODO_API_KEY", raising=False)
        try:
            billing_routes.dodo_auth()
        except RuntimeError as err:
            assert "DODO_TEST_API_KEY" in str(err)
        else:
            raise AssertionError("expected RuntimeError when no Dodo API key is set")

    async def test_auth_header_uses_mode_key(self, monkeypatch) -> None:
        monkeypatch.setenv("DODO_TEST_API_KEY", "test-key")
        monkeypatch.delenv("DODO_ENV", raising=False)
        assert billing_routes.dodo_auth() == "Bearer test-key"