import pytest

from yomi.crypto import (
    EncryptionKeyError,
    OAuthTokens,
    decrypt_string,
    decrypt_tokens,
    encrypt_string,
    encrypt_tokens,
)
from yomi.services.ai_telemetry import _clamp, sanitize_telemetry_metadata


def _set_key(monkeypatch, value: str = "a" * 64):
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", value)
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")


def test_encrypt_requires_64_hex(monkeypatch):
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "")
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")
    with pytest.raises(EncryptionKeyError):
        encrypt_string("secret")


def test_roundtrip(monkeypatch):
    _set_key(monkeypatch)
    encrypted = encrypt_string("hello world")
    assert encrypted != "hello world"
    assert decrypt_string(encrypted) == "hello world"


def test_randomized_iv_unique_ciphertexts(monkeypatch):
    _set_key(monkeypatch)
    plain = "same text"
    assert encrypt_string(plain) != encrypt_string(plain)


def test_old_key_fallback_decrypts(monkeypatch):
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "b" * 64)
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")
    encrypted_with_old_key = encrypt_string("legacy")

    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "c" * 64)
    monkeypatch.setattr(
        "yomi.crypto.settings.encryption_key_fallbacks", f"{'b' * 64},{'d' * 64}"
    )
    assert decrypt_string(encrypted_with_old_key) == "legacy"


def test_tokens_roundtrip(monkeypatch):
    _set_key(monkeypatch)
    tokens = OAuthTokens(access_token="ya29.abc", refresh_token="1//token", expires_at=123)
    encrypted = encrypt_tokens(tokens)
    decrypted = decrypt_tokens(encrypted)
    assert decrypted.access_token == "ya29.abc"
    assert decrypted.refresh_token == "1//token"
    assert decrypted.expires_at == 123


def test_sanitize_telemetry_metadata():
    assert sanitize_telemetry_metadata(None) is None
    assert sanitize_telemetry_metadata({}) is None
    out = sanitize_telemetry_metadata({"prompt": "secret", "model": "gpt-5.5", "count": 2})
    assert out == {"model": "gpt-5.5", "count": 2}
    assert sanitize_telemetry_metadata({"MESSAGES": "x"}) is None


def test_clamp():
    assert _clamp(None) == 0
    assert _clamp(-3) == 0
    assert _clamp(12.7) == 12
    assert _clamp(True) == 0
    assert _clamp("nope") == 0