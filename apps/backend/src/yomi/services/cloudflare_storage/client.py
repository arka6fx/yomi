"""Typed HTTP boundary to the binding-backed storage Worker.

D1 batch is an atomic transaction. Separate calls are separate transactions;
this deliberately does not emulate SQLAlchemy's AsyncSession/commit interface.
Writes are never retried implicitly: a transport failure has an unknown outcome.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx

from yomi.conf import settings

Scalar = str | int | float | None
RecordType = Literal["memory", "rag"]


@dataclass(frozen=True)
class Statement:
    sql: str
    params: list[Scalar] = field(default_factory=list)

    def payload(self) -> dict[str, Any]:
        if not self.sql or len(self.sql.encode()) > 100_000 or len(self.params) > 100:
            raise ValueError("D1 statement exceeds SQL/parameter limits")
        for value in self.params:
            if value is not None and not isinstance(value, (str, int, float)):
                raise ValueError(
                    "D1 parameters must be scalar; serialize JSON and dates explicitly"
                )
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("D1 parameters must be finite")
        params = [int(p) if isinstance(p, bool) else p for p in self.params]
        return {"sql": self.sql, "params": params}


class StorageError(RuntimeError):
    """Sanitized boundary error; no SQL, credentials, or remote response bodies."""


class StorageClient:
    def __init__(self, http: httpx.AsyncClient, url: str, secret: str):
        parsed = urlsplit(url)
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
        ):
            raise ValueError("Storage gateway requires HTTPS (except localhost)")
        if (
            not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Invalid storage gateway URL")
        if len(secret) < 32:
            raise ValueError("STORAGE_GATEWAY_SECRET must have at least 32 characters")
        self.http = http
        self.url = url.rstrip("/")
        self.secret = secret

    @classmethod
    def configured(cls, http: httpx.AsyncClient) -> StorageClient:
        return cls(http, settings.storage_gateway_url, settings.storage_gateway_secret)

    async def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self.http.post(
                f"{self.url}{path}",
                headers={"Authorization": f"Bearer {self.secret}"},
                json=payload,
                timeout=35.0,
                follow_redirects=False,
            )
        except httpx.HTTPError:
            raise StorageError("Storage transport failed; write outcome may be unknown") from None
        if response.status_code != 200:
            raise StorageError(f"Storage request failed (HTTP {response.status_code})")
        try:
            data = response.json()
        except ValueError:
            raise StorageError("Invalid storage response") from None
        if not isinstance(data, dict) or data.get("success") is False:
            raise StorageError("Storage operation failed")
        return data

    async def query(self, sql: str, params: list[Scalar] | None = None) -> list[dict[str, Any]]:
        result = await self.post("/d1/query", Statement(sql, params or []).payload())
        rows = result.get("results")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise StorageError("Invalid D1 result")
        return rows

    async def batch(self, statements: list[Statement]) -> list[dict[str, Any]]:
        if not 1 <= len(statements) <= 100:
            raise ValueError("D1 batches require 1–100 statements")
        result = await self.post("/d1/batch", {"statements": [s.payload() for s in statements]})
        results = result.get("results")
        if not isinstance(results, list) or len(results) != len(statements) or not all(
            isinstance(r, dict) and r.get("success") is True for r in results
        ):
            raise StorageError("D1 batch did not confirm all statements")
        return results

    async def vector_query(
        self,
        user_id: str,
        kind: RecordType,
        values: list[float],
        limit: int = 20,
        return_values: bool = False,
    ) -> list[dict[str, Any]]:
        result = await self.post("/vectors/query", {
            "userId": user_id, "kind": kind, "values": values, "topK": limit,
            "returnValues": return_values,
        })
        matches = result.get("matches")
        if not isinstance(matches, list):
            raise StorageError("Invalid Vectorize response")
        return matches
