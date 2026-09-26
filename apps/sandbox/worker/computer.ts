/**
 * Yomi computer gateway: one isolated Linux desktop per user workspace.
 *
 * The agent (and later, the human viewer) never touches sandbox internals:
 * every operation goes through the control service inside the sandbox over
 * the Sandbox SDK's process API (`exec` + `curl` to localhost:8081). This
 * uses only stable preview APIs — no port exposure, no tunnels yet.
 *
 * Workspace <-> sandbox mapping: sandbox id `yomi-<workspace>`, where the
 * workspace is the Yomi user id supplied by the Python backend. Auth is a
 * single deployment secret; per-user authorization lives in Python.
 */
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

export class Computer extends Sandbox {
  // Idle desktops sleep fast: memory/disk bill only while running.
  sleepAfter = "5m";
}

interface Env {
  Computer: DurableObjectNamespace<Computer>;
  COMPUTER_GATEWAY_SECRET: string;
}

const CONTROL_BASE = "http://127.0.0.1:8081";
const WORKSPACE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 256 * 1024;

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function readBody(request: Request): Promise<unknown> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return {};
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error("Request too large");
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error("Invalid JSON object");
  }
}

function checkAuth(request: Request, env: Env): boolean {
  if (!env.COMPUTER_GATEWAY_SECRET || env.COMPUTER_GATEWAY_SECRET.length < 32) {
    return false;
  }
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const actual = header.slice("Bearer ".length);
  const expected = env.COMPUTER_GATEWAY_SECRET;
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

interface SandboxHandle {
  exec(argv: string[]): Promise<{
    output(options?: { encoding?: string }): Promise<{ stdout: string; exitCode: number }>;
  }>;
}

/** Run curl inside the sandbox against the control service; parse its reply. */
async function control(
  sandbox: SandboxHandle,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const argv = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, `${CONTROL_BASE}${path}`];
  if (body !== undefined) {
    argv.push(
      "-H", "Content-Type: application/json",
      "--data-binary", JSON.stringify(body),
    );
  }
  const proc = await sandbox.exec(argv);
  const { stdout, exitCode } = await proc.output({ encoding: "utf8" });
  if (exitCode !== 0) {
    throw new Error(`Control plane unreachable (curl exit ${exitCode})`);
  }
  const marker = stdout.lastIndexOf("\n");
  const status = Number.parseInt(stdout.slice(marker + 1).trim(), 10);
  const payload = stdout.slice(0, marker);
  let json: unknown = null;
  try {
    json = payload ? JSON.parse(payload) : null;
  } catch {
    json = { raw: payload };
  }
  return { status: Number.isFinite(status) ? status : 502, json };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!checkAuth(request, env)) return unauthorized();

    const url = new URL(request.url);
    const match = url.pathname.match(
      /^\/computer\/([^/]+)\/(health|screenshot|windows|input|open|exec|browser-snapshot|browser-navigate|browser-act)$/,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (!match) return badRequest("Unknown computer endpoint");
    const [, workspace, action] = match;
    if (!WORKSPACE_PATTERN.test(workspace)) return badRequest("Invalid workspace");

    try {
      const sandbox = getSandbox(env.Computer, `yomi-${workspace}`) as unknown as SandboxHandle;

      if (action === "health" && request.method === "GET") {
        const result = await control(sandbox, "GET", "/health");
        return Response.json(result.json, { status: result.status });
      }
      if (action === "windows" && request.method === "GET") {
        const result = await control(sandbox, "GET", "/windows");
        return Response.json(result.json, { status: result.status });
      }
      if (action === "screenshot" && request.method === "GET") {
        const result = await control(sandbox, "GET", "/screenshot?format=base64");
        const png = (result.json as { png?: string } | null)?.png;
        if (result.status !== 200 || typeof png !== "string") {
          return Response.json({ error: "Screenshot failed" }, { status: 502 });
        }
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      }
      if (action === "browser-snapshot" && request.method === "GET") {
        const result = await control(sandbox, "GET", "/browser/snapshot");
        return Response.json(result.json, { status: result.status });
      }
      if ((action === "browser-navigate" || action === "browser-act") && request.method === "POST") {
        const body = await readBody(request);
        const path = action === "browser-navigate" ? "/browser/navigate" : "/browser/act";
        const result = await control(sandbox, "POST", path, body);
        return Response.json(result.json, { status: result.status });
      }
      if ((action === "input" || action === "open") && request.method === "POST") {
        const body = await readBody(request);
        const result = await control(sandbox, "POST", `/${action}`, body);
        return Response.json(result.json, { status: result.status });
      }
      if (action === "exec" && request.method === "POST") {
        // Escape hatch: argv-only process execution for file/profile ops.
        const body = (await readBody(request)) as { argv?: unknown };
        if (
          !Array.isArray(body.argv) || body.argv.length === 0 || body.argv.length > 32 ||
          !body.argv.every((entry) => typeof entry === "string" && entry.length <= 4096)
        ) {
          return badRequest("argv must be 1-32 strings");
        }
        const proc = await sandbox.exec(body.argv as string[]);
        const { stdout, exitCode } = await proc.output({ encoding: "utf8" });
        return Response.json({ stdout: stdout.slice(-20000), exitCode });
      }
      return badRequest("Method not allowed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (/too large|invalid json|unreachable/i.test(message)) {
        return badRequest(message);
      }
      console.error("computer operation failed", { workspace: workspace.slice(0, 8) });
      return Response.json({ error: "Computer operation failed" }, { status: 502 });
    }
  },
};
