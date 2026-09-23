/** Native bindings for the Python container's authenticated storage client. */
export interface StorageEnv {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  R2_INGEST: R2Bucket;
  STORAGE_GATEWAY_SECRET: string;
}

const DIMENSIONS = 768;
const MAX_BODY_BYTES = 1_000_000;
// Drive-sync content passes through R2 as a short-lived temp object: the
// worker fetches the composio presigned URL so the Python container never
// touches Amazon S3 directly. Objects older than this are garbage-collected
// opportunistically on each put.
const MAX_INGEST_BYTES = 8 * 1024 * 1024;
const INGEST_TTL_MS = 24 * 60 * 60 * 1000;
const INGEST_KEY_RE = /^ingest\/[a-zA-Z0-9._/-]+$/;
type RecordType = "memory" | "rag";
type JsonObject = Record<string, unknown>;

class InvalidRequest extends Error {}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidRequest("Expected an object");
  }
  return value as JsonObject;
}

function string(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.length || value.length > max) {
    throw new InvalidRequest("Invalid string");
  }
  return value;
}

function items(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > max) {
    throw new InvalidRequest("Invalid batch size");
  }
  return value;
}

function vector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== DIMENSIONS ||
      !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new InvalidRequest(`Expected ${DIMENSIONS} finite dimensions`);
  }
  return value as number[];
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 512) return false;
  const actual = await digest(header.slice(7));
  const expected = await digest(secret);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

async function body(request: Request): Promise<JsonObject> {
  if (!request.body) throw new InvalidRequest("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new InvalidRequest("Request too large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new InvalidRequest("Invalid JSON object");
  }
}

function statement(session: D1DatabaseSession, value: unknown): D1PreparedStatement {
  const input = object(value);
  const sql = string(input.sql, 100_000);
  const params = input.params ?? [];
  if (!Array.isArray(params) || params.length > 100 || !params.every((p) =>
    p === null || typeof p === "string" || (typeof p === "number" && Number.isFinite(p)))) {
    throw new InvalidRequest("SQL parameters must be strings, finite numbers, or null");
  }
  return session.prepare(sql).bind(...params);
}

async function scope(input: JsonObject): Promise<{ namespace: string; kind: RecordType }> {
  const userId = string(input.userId);
  if (input.kind !== "memory" && input.kind !== "rag") {
    throw new InvalidRequest("Unknown vector kind");
  }
  return { namespace: await digest(JSON.stringify([userId, input.kind])), kind: input.kind };
}

async function identity(namespace: string, item: JsonObject) {
  const recordId = string(item.recordId);
  const revision = string(item.revision, 64);
  return {
    id: await digest(JSON.stringify([namespace, recordId, revision])),
    recordId,
    revision,
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function storageFetch(request: Request, env: StorageEnv): Promise<Response> {
  if (!env.STORAGE_GATEWAY_SECRET || env.STORAGE_GATEWAY_SECRET.length < 32) {
    return json({ error: "Storage gateway is not configured" }, 503);
  }
  if (!(await authorized(request, env.STORAGE_GATEWAY_SECRET))) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const path = new URL(request.url).pathname;
    const input = await body(request);
    if (path === "/ingest/put") return await ingestPut(env, input);
    if (path === "/ingest/read") return await ingestRead(env, input);
    if (path === "/ingest/delete") return await ingestDelete(env, input);
    if (path === "/d1/query" || path === "/d1/batch") {
      // Primary reads avoid stale balances/auth during and after the migration.
      const session = env.DB.withSession("first-primary");
      if (path === "/d1/query") {
        return json(await statement(session, input).all());
      }
      const statements = items(input.statements, 100).map((s) => statement(session, s));
      return json({ results: await session.batch(statements) });
    }

    if (!path.startsWith("/vectors/")) return json({ error: "Not found" }, 404);
    const { namespace } = await scope(input);
    if (path === "/vectors/query") {
      const topK = input.topK ?? 20;
      if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1 || topK > 50) {
        throw new InvalidRequest("topK must be between 1 and 50");
      }
      // Vector values are large (1536 floats); only return them when the
      // caller needs them for local reranking (RAG MMR). Defaults to false.
      const returnValues = input.returnValues ?? false;
      if (typeof returnValues !== "boolean") {
        throw new InvalidRequest("returnValues must be a boolean");
      }
      const result = await env.VECTORS.query(vector(input.values), {
        namespace, topK, returnMetadata: "all", returnValues,
      });
      return json({ matches: result.matches.map((match) => ({
        recordId: match.metadata?.recordId,
        revision: match.metadata?.revision,
        score: match.score,
        values: match.values ?? undefined,
      })) });
    }
    if (path === "/vectors/upsert") {
      const vectors = await Promise.all(items(input.records, 20).map(async (raw) => {
        const item = object(raw);
        const { id, recordId, revision } = await identity(namespace, item);
        return { id, namespace, values: vector(item.values), metadata: { recordId, revision } };
      }));
      return json(await env.VECTORS.upsert(vectors));
    }
    if (path === "/vectors/delete") {
      const ids = await Promise.all(items(input.records, 100).map(async (raw) =>
        (await identity(namespace, object(raw))).id));
      return json(await env.VECTORS.deleteByIds(ids));
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof InvalidRequest) return json({ error: error.message }, 400);
    // SQL/parameters may contain credentials, memory, or user data.
    console.error("storage operation failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return json({ error: "Storage operation failed" }, 502);
  }
}

async function ingestKey(input: JsonObject): Promise<string> {
  const full = string(input.key, 300);
  if (!INGEST_KEY_RE.test(full)) throw new InvalidRequest("Invalid key");
  return full;
}

async function fetchBytes(url: string): Promise<[Uint8Array, string]> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new InvalidRequest("Invalid url");
  }
  if (target.protocol !== "https:") throw new InvalidRequest("url must be https");
  let upstream: Response;
  try {
    upstream = await fetch(target, { redirect: "follow" });
  } catch {
    throw new InvalidRequest("Upstream fetch failed");
  }
  if (!upstream.ok || !upstream.body) throw new InvalidRequest(`Upstream HTTP ${upstream.status}`);
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_INGEST_BYTES) {
      await reader.cancel();
      throw new InvalidRequest("Upstream content too large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return [bytes, upstream.headers.get("content-type") ?? "application/octet-stream"];
}

async function garbageCollect(bucket: R2Bucket): Promise<void> {
  // Best-effort: drop temp objects older than INGEST_TTL_MS on each put.
  const cutoff = Date.now() - INGEST_TTL_MS;
  const listed = await bucket.list({ prefix: "ingest/", limit: 100 });
  await Promise.all(listed.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => bucket.delete(o.key)));
}

async function ingestPut(env: StorageEnv, input: JsonObject): Promise<Response> {
  const url = string(input.url, 4_000);
  const rawPrefix = typeof input.prefix === "string" && input.prefix.length ? input.prefix : "drive";
  if (!/^[a-zA-Z0-9._-]+$/.test(rawPrefix) || rawPrefix.length > 128) {
    throw new InvalidRequest("Invalid prefix");
  }
  const [bytes, contentType] = await fetchBytes(url);
  const key = `ingest/${rawPrefix}/${crypto.randomUUID()}`;
  await env.R2_INGEST.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { fetchedAtMs: String(Date.now()) },
  });
  await garbageCollect(env.R2_INGEST);
  return json({ key, size: bytes.byteLength, contentType });
}

async function ingestRead(env: StorageEnv, input: JsonObject): Promise<Response> {
  const key = await ingestKey(input);
  const stored = await env.R2_INGEST.get(key);
  if (!stored) return json({ error: "Not found" }, 404);
  return new Response(stored.body, {
    headers: {
      "content-type": stored.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

async function ingestDelete(env: StorageEnv, input: JsonObject): Promise<Response> {
  const key = await ingestKey(input);
  await env.R2_INGEST.delete(key);
  return json({ ok: true });
}
