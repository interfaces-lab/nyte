import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { compile } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import {
  errorStatus,
  openHostSocket,
  OPERATIONS_HEADER,
  operationsDigest,
} from "@nyte-ai/protocol";
import type { HostSocket, SocketLike } from "@nyte-ai/protocol";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk/client";
import { HOST_TAKEN_EXIT, hostFilePath, hostSocketPath } from "../src/host-endpoint.ts";

const TUI_ENTRY = fileURLToPath(new URL("../../tui/src/binary.ts", import.meta.url));

const REDIRECT = "http://127.0.0.1:1/callback";

const START_MS = 120_000;

const STOP_MS = 30_000;

const CALL_MS = 15_000;

const ListeningType = Type.Object({
  type: Type.Literal("listening"),
  url: Type.String(),
  socket: Type.Optional(Type.String()),
  endpoint: Type.String(),
  pid: Type.Integer(),
});

type Listening = Static<typeof ListeningType>;

const listenings = compile(ListeningType);

const HostFileType = Type.Object({
  url: Type.String(),
  token: Type.String(),
  pid: Type.Integer(),
  socket: Type.Optional(Type.String()),
});

const DescriptionType = Type.Object({
  name: Type.String(),
  platform: Type.String(),
  version: Type.String(),
});

const PagedType = Type.Object({ items: Type.Array(Type.Unknown()) });

type HeaderSocket = new (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => SocketLike;

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

interface HostProcess {
  readonly child: ChildProcess;
  readonly listening: Promise<Listening>;
  readonly exited: Promise<Exit>;
  readonly stderr: () => string;
}

interface Passed<T> {
  readonly result: string;
  readonly value: T;
}

interface Row {
  readonly check: string;
  readonly via: string;
  readonly ok: boolean;
  readonly result: string;
  readonly ms: number;
}

const rows: Row[] = [];

const own = await operationsDigest();

let rpcId = 0;

const args = process.argv.slice(2);

if (args.some((arg) => arg !== "--attach"))
  throw new Error("Usage: pnpm --dir packages/service verify:host [--attach]");

if (args.includes("--attach")) await verifyAttached();
else await verifyServed();

printTable(rows);

process.exitCode = rows.every((row) => row.ok) ? 0 : 1;

/** Read-only checks against the host serving `~/.nyte`, over `host.sock` alone: the socket admits its caller as the owner, so no token is read. */
async function verifyAttached(): Promise<void> {
  const socket = hostSocketPath();

  await step("describe", `GET /.nyte/describe, ${socket}`, async () => {
    const response = await socketFetch(socket, "GET", "/.nyte/describe");
    const description = await read(response, DescriptionType);
    const digest = response.headers.get(OPERATIONS_HEADER);

    return `version ${description.version}, operations digest ${digest === own ? "matches" : `${String(digest)} differs from`} this checkout`;
  });

  await step("sessions.list", `POST /sessions.list, ${socket}`, async () => {
    const page = await read(
      await socketFetch(socket, "POST", "/sessions.list", { limit: 1 }),
      PagedType,
    );

    return `${String(page.items.length)} sessions`;
  });
}

async function verifyServed(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "nyte-vh-"));
  const home = join(root, "home");
  const env = isolatedEnv(home);
  const hosts = new Set<HostProcess>();
  await mkdir(home, { recursive: true });

  try {
    await servedChecks(root, env, hosts);
  } finally {
    await Promise.all([...hosts].map((host) => stopHost(host)));
    await rm(root, { recursive: true, force: true });
  }
}

async function servedChecks(
  root: string,
  env: NodeJS.ProcessEnv,
  hosts: Set<HostProcess>,
): Promise<void> {
  const hostFile = hostFilePath(env);
  const socket = hostSocketPath(env);
  const first = spawnHost(root, env, hosts);

  const listening = await obtain("host starts", "bun tui binary.ts host --json", async () => {
    const value = await within(START_MS, "listening", first.listening);

    if (value.pid !== first.child.pid)
      throw new Error(
        `listening names pid ${String(value.pid)}, child is ${String(first.child.pid)}`,
      );

    return { result: `listening on ${value.url}`, value };
  });

  if (listening === undefined) return;
  const url = listening.url;

  const token = await obtain("host.json published", "$NYTE_HOME/host.json", async () => {
    const mode = (await stat(hostFile)).mode & 0o777;

    const published = checked(
      parseJson(await readFile(hostFile, "utf8")),
      HostFileType,
      "host.json",
    );

    if (mode !== 0o600) throw new Error(`mode ${mode.toString(8)}, want 600`);

    if (published.pid !== first.child.pid)
      throw new Error(`names pid ${String(published.pid)}, child is ${String(first.child.pid)}`);

    if (published.url !== url) throw new Error(`names ${published.url}, listening on ${url}`);

    if (published.socket !== socket) throw new Error(`names socket ${String(published.socket)}`);

    return {
      result: `mode 600, pid ${String(published.pid)}, url and socket match`,
      value: published.token,
    };
  });

  await step("host.sock bound", "$NYTE_HOME/host.sock", async () => {
    const found = await stat(socket);
    const mode = found.mode & 0o777;

    if (!found.isSocket()) throw new Error("not a socket");

    if (mode !== 0o600) throw new Error(`mode ${mode.toString(8)}, want 600`);

    return "socket, mode 600";
  });

  await step("describe over HTTP", "GET /.nyte/describe", () =>
    describes(fetch(new URL("/.nyte/describe", url), { signal: AbortSignal.timeout(CALL_MS) })),
  );

  await step("describe over host.sock", "GET /.nyte/describe, host.sock", () =>
    describes(socketFetch(socket, "GET", "/.nyte/describe")),
  );

  await step("no token refused", "POST /sessions.list", () =>
    status(post(url, "/sessions.list", { limit: 1 }), errorStatus.unauthenticated),
  );

  await step("wrong token refused", "POST /sessions.list, Bearer wrong", () =>
    status(
      post(url, "/sessions.list", { limit: 1 }, { Authorization: `Bearer ${"x".repeat(43)}` }),
      errorStatus.unauthenticated,
    ),
  );

  await step("valid token accepted", "POST /sessions.list, Bearer token", async () =>
    status(post(url, "/sessions.list", { limit: 1 }, bearer(need(token, "host.json"))), 200),
  );

  const connection = await obtain("sdk connects", "sdk.connect, HTTP", async () => {
    const value = await within(
      CALL_MS,
      "sdk.connect",
      sdk.connect({ url, credentials: { kind: "token", token: need(token, "host.json") } }),
    );

    return { result: `host ${value.hostId}`, value };
  });

  await step("sdk sessions.list", "sdk.connect, HTTP", async () => {
    const page = await within(
      CALL_MS,
      "sessions.list",
      need(connection, "sdk.connect").sessions.list({ limit: 1 }),
    );

    return `${String(page.items.length)} sessions`;
  });

  await step("sdk models.list", "sdk.connect, HTTP", async () => {
    const catalog = await within(
      CALL_MS,
      "models.list",
      need(connection, "sdk.connect").models.list(),
    );

    return `${String(catalog.providers.length)} providers`;
  });

  await closeConnection(connection);

  await step("WebSocket with token", "GET /.nyte/ws, Bearer token", async () => {
    const opened = await within(
      CALL_MS,
      "the socket",
      openSocket(url, bearer(need(token, "host.json"))),
    );

    const welcome = await within(CALL_MS, "the welcome", opened.welcome);
    opened.close();

    return `welcome, api revision ${String(welcome.api_revision)}`;
  });

  await step("WebSocket without token refused", "GET /.nyte/ws", async () => {
    const outcome = await within(
      CALL_MS,
      "the refusal",
      openSocket(url, {}).then(
        (opened) =>
          opened.welcome.then(
            () => {
              opened.close();

              return null;
            },
            (cause: unknown) => `closed: ${message(cause)}`,
          ),
        (cause: unknown) => `refused: ${message(cause)}`,
      ),
    );

    if (outcome === null) throw new Error("a socket without a token got a welcome");

    return outcome;
  });

  await mcpChecks(url, socket);

  await step("second host refused", "bun tui binary.ts host --json, same home", async () => {
    const second = spawnHost(root, env, hosts);

    const ended = await within(
      START_MS,
      "the second host",
      Promise.race([second.exited, second.listening.then(() => null)]),
    );

    if (ended === null) throw new Error("a second host listened on the same home");

    if (ended.code !== HOST_TAKEN_EXIT)
      throw new Error(
        `exited ${describeExit(ended)}, want ${String(HOST_TAKEN_EXIT)}: ${second.stderr()}`,
      );

    return `exited ${String(ended.code)}`;
  });

  await step("host.json keeps the first host", "$NYTE_HOME/host.json", async () => {
    const published = checked(
      parseJson(await readFile(hostFile, "utf8")),
      HostFileType,
      "host.json",
    );

    if (published.pid !== first.child.pid)
      throw new Error(`names pid ${String(published.pid)}, first is ${String(first.child.pid)}`);

    return `names pid ${String(published.pid)}`;
  });

  await step("SIGTERM withdraws host.json", "kill -TERM child", async () => {
    const exit = await stopHost(first);

    if (existsSync(hostFile)) throw new Error(`exited ${describeExit(exit)}, host.json remains`);

    return `exited ${describeExit(exit)}, host.json removed`;
  });

  await step(
    "fresh host on the same home",
    "bun tui binary.ts host --json, then SIGTERM",
    async () => {
      const fresh = spawnHost(root, env, hosts);
      const value = await within(START_MS, "listening", fresh.listening);

      const published = checked(
        parseJson(await readFile(hostFile, "utf8")),
        HostFileType,
        "host.json",
      );

      if (published.pid !== fresh.child.pid)
        throw new Error(
          `host.json names pid ${String(published.pid)}, fresh is ${String(fresh.child.pid)}`,
        );
      const exit = await stopHost(fresh);

      if (existsSync(hostFile)) throw new Error(`stopped ${describeExit(exit)}, host.json remains`);

      return `listened on ${value.url} as pid ${String(published.pid)}, stopped ${describeExit(exit)}`;
    },
  );
}

/** The OAuth sign-in and tool calls of `mcp-agents` and the MCP server's tests, against the served host. */
async function mcpChecks(url: string, socket: string): Promise<void> {
  const resource = `${url}/mcp`;

  await step("MCP resource metadata", "GET /.well-known/oauth-protected-resource", async () => {
    const metadata = await read(
      await fetch(new URL("/.well-known/oauth-protected-resource", url), {
        signal: AbortSignal.timeout(CALL_MS),
      }),
      Type.Object({ resource: Type.String(), authorization_servers: Type.Array(Type.String()) }),
    );

    if (metadata.resource !== resource)
      throw new Error(`resource ${metadata.resource}, want ${resource}`);

    if (!metadata.authorization_servers.includes(url))
      throw new Error(`authorization servers ${metadata.authorization_servers.join(", ")}`);

    return `resource ${metadata.resource}`;
  });

  await step("bare /mcp challenged", "POST /mcp", async () => {
    const response = await post(url, "/mcp", {});
    const challenge = response.headers.get("WWW-Authenticate");
    await response.body?.cancel();

    if (response.status !== 401) throw new Error(`answered ${String(response.status)}, want 401`);

    if (challenge?.includes("resource_metadata=") !== true)
      throw new Error(`WWW-Authenticate ${String(challenge)}`);

    return `401, ${challenge}`;
  });

  const client = await obtain("OAuth register", "POST /oauth/register", async () => {
    const registered = await read(
      await post(url, "/oauth/register", {
        client_name: "verify-host",
        application_type: "native",
        redirect_uris: [REDIRECT],
      }),
      Type.Object({ client_id: Type.String() }),
    );

    return { result: "public client registered", value: registered.client_id };
  });

  const authorizing = await obtain("OAuth authorize, PKCE", "GET /oauth/authorize", async () => {
    const verifier = randomBytes(32).toString("base64url");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: need(client, "registration"),
      redirect_uri: REDIRECT,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource,
      state: randomBytes(8).toString("hex"),
    });

    const page = await (
      await fetch(new URL(`/oauth/authorize?${params.toString()}`, url), {
        signal: AbortSignal.timeout(CALL_MS),
      })
    ).text();

    const pending = /data-request="([^"]+)"/.exec(page)?.[1];
    const code = /<code id="code">([^<]+)<\/code>/.exec(page)?.[1];

    if (pending === undefined || code === undefined)
      throw new Error("the authorize page shows no code");

    return { result: `page shows code ${code}`, value: { verifier, pending, code } };
  });

  const approved = await obtain("owner approves", "POST /mcp.approve, host.sock", async () => {
    const answer = await read(
      await socketFetch(socket, "POST", "/mcp.approve", {
        code: need(authorizing, "authorize").code,
        access: { kind: "read-only" },
      }),
      Type.Object({ client: Type.String() }),
    );

    return { result: `approved ${answer.client}, read-only`, value: true };
  });

  const access = await obtain("OAuth token exchange", "POST /oauth/token", async () => {
    need(approved, "approval");
    const pending = need(authorizing, "authorize");

    const state = await read(
      await fetch(new URL(`/oauth/authorize/state?request=${pending.pending}`, url), {
        signal: AbortSignal.timeout(CALL_MS),
      }),
      Type.Object({ location: Type.String() }),
    );

    const code = new URL(state.location).searchParams.get("code");

    if (code === null) throw new Error(`the sign-in ended without a code: ${state.location}`);

    const tokens = await read(
      await fetch(new URL("/oauth/token", url), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: need(client, "registration"),
          code_verifier: pending.verifier,
          resource,
        }).toString(),
        signal: AbortSignal.timeout(CALL_MS),
      }),
      Type.Object({ token_type: Type.Literal("Bearer"), access_token: Type.String() }),
    );

    return { result: "Bearer access token issued", value: tokens.access_token };
  });

  await step("MCP initialize", "POST /mcp initialize", async () => {
    const answer = await rpc(
      url,
      need(access, "a token"),
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "verify-host", version: "1" },
      },
      Type.Object({
        result: Type.Object({
          protocolVersion: Type.String(),
          serverInfo: Type.Object({ name: Type.Literal("nyte") }),
        }),
      }),
    );

    return `server nyte, protocol ${answer.result.protocolVersion}`;
  });

  await step("MCP tools/list", "POST /mcp tools/list", async () => {
    const answer = await rpc(
      url,
      need(access, "a token"),
      "tools/list",
      {},
      Type.Object({
        result: Type.Object({ tools: Type.Array(Type.Object({ name: Type.String() })) }),
      }),
    );

    const names = answer.result.tools.map((tool) => tool.name);

    if (!names.includes("sessions_list"))
      throw new Error(`no sessions_list in ${names.join(", ")}`);

    return `${String(names.length)} tools, sessions_list among them`;
  });

  await step("MCP tools/call sessions_list", "POST /mcp tools/call", async () => {
    const answer = await rpc(
      url,
      need(access, "a token"),
      "tools/call",
      { name: "sessions_list", arguments: { limit: 10 } },
      Type.Object({
        result: Type.Object({
          isError: Type.Optional(Type.Boolean()),
          structuredContent: PagedType,
        }),
      }),
    );

    if (answer.result.isError === true) throw new Error("the tool answered an error");

    return `${String(answer.result.structuredContent.items.length)} sessions`;
  });

  await step("MCP token off /mcp refused", "POST /sessions.list, Bearer MCP token", async () =>
    status(
      post(url, "/sessions.list", { limit: 1 }, bearer(need(access, "a token"))),
      errorStatus.denied,
    ),
  );
}

async function describes(answered: Promise<Response>): Promise<string> {
  const response = await answered;
  const description = await read(response, DescriptionType);
  const digest = response.headers.get(OPERATIONS_HEADER);

  if (digest !== own)
    throw new Error(`operations digest ${String(digest)}, this checkout's is ${own}`);

  return `version ${description.version}, digest ${own}`;
}

async function status(answered: Promise<Response>, expected: number): Promise<string> {
  const response = await answered;
  const text = await response.text();

  if (response.status !== expected)
    throw new Error(
      `answered ${String(response.status)}, want ${String(expected)}: ${text.slice(0, 160)}`,
    );

  return String(response.status);
}

async function rpc<T extends TSchema>(
  url: string,
  token: string,
  method: string,
  params: Json,
  type: T,
): Promise<Static<T>> {
  rpcId += 1;

  const response = await post(
    url,
    "/mcp",
    { jsonrpc: "2.0", id: rpcId, method, params },
    { ...bearer(token), Accept: "application/json, text/event-stream" },
  );

  const text = await response.text();

  if (response.status !== 200)
    throw new Error(`answered ${String(response.status)}: ${text.slice(0, 160)}`);
  const frame = text.split("\n").findLast((line) => line.startsWith("data: "));

  return checked(
    parseJson(frame === undefined ? text : frame.slice("data: ".length)),
    type,
    method,
  );
}

function openSocket(url: string, headers: Readonly<Record<string, string>>): Promise<HostSocket> {
  const Socket: unknown = globalThis.WebSocket;

  if (!headerSocketClass(Socket)) throw new Error("This runtime has no WebSocket.");
  const target = new URL("/.nyte/ws", url);
  target.protocol = "ws:";

  return openHostSocket({
    socket: new Socket(target.href, { headers }),
    client: { kind: "cli", name: "verify-host", version: "0", actions: [] },
  });
}

function headerSocketClass(value: unknown): value is HeaderSocket {
  if (typeof value !== "function") return false;

  return "CONNECTING" in value;
}

async function closeConnection(connection: Connection | undefined): Promise<void> {
  await connection?.close().catch(() => undefined);
}

/** Starts `nyte host --json` from this checkout's TUI on `env`'s home, the way the TUI runs from source. */
function spawnHost(root: string, env: NodeJS.ProcessEnv, hosts: Set<HostProcess>): HostProcess {
  const child = spawn("bun", [TUI_ENTRY, "host", "--json"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const errors: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString("utf8")));

  const exited = new Promise<Exit>((done) => {
    child.once("exit", (code, signal) => done({ code, signal }));
    child.once("error", () => done({ code: null, signal: null }));
  });

  const listening = new Promise<Listening>((found, failed) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const value = parseJson(line);

      if (listenings.Check(value)) found(value);
    });
    void exited.then((exit) =>
      failed(new Error(`exited ${describeExit(exit)} before listening: ${tail(errors)}`)),
    );
  });

  listening.catch(() => undefined);
  const host = { child, listening, exited, stderr: () => tail(errors) };
  hosts.add(host);
  void exited.then(() => hosts.delete(host));

  return host;
}

/** Sends SIGTERM to this script's own child and waits for it, then SIGKILL if it outlives `STOP_MS`. */
async function stopHost(host: HostProcess): Promise<Exit> {
  if (host.child.exitCode !== null || host.child.signalCode !== null) return host.exited;
  host.child.kill("SIGTERM");

  return within(STOP_MS, "the host's exit", host.exited).catch(() => {
    host.child.kill("SIGKILL");

    return host.exited;
  });
}

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter((entry) => !entry[0].startsWith("NYTE_"));

  return {
    ...Object.fromEntries(inherited),
    HOME: home,
    NYTE_HOME: join(home, ".nyte"),
    NYTE_SKIP_VERSION_CHECK: "1",
  };
}

function socketFetch(
  socket: string,
  method: "GET" | "POST",
  path: string,
  body?: Json,
): Promise<Response> {
  const payload = body === undefined ? "" : JSON.stringify(body);

  return new Promise((done, failed) => {
    const sent = request(
      {
        socketPath: socket,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: CALL_MS,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        const headers = new Headers();

        for (const name of Object.keys(incoming.headers)) {
          const value = incoming.headers[name];

          if (typeof value === "string") headers.set(name, value);
        }

        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", failed);
        incoming.on("end", () =>
          done(
            new Response(Buffer.concat(chunks).toString("utf8"), {
              status: incoming.statusCode ?? 502,
              headers,
            }),
          ),
        );
      },
    );

    sent.once("timeout", () => sent.destroy(new Error(`${path} took over ${String(CALL_MS)} ms`)));
    sent.once("error", failed);
    sent.end(payload);
  });
}

function post(
  url: string,
  path: string,
  body: Json,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return fetch(new URL(path, url), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_MS),
  });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function read<T extends TSchema>(response: Response, type: T): Promise<Static<T>> {
  const text = await response.text();
  const value = parseJson(text);

  if (!response.ok || !compile(type).Check(value))
    throw new Error(`answered ${String(response.status)}: ${text.slice(0, 160)}`);

  return value;
}

function checked<T extends TSchema>(value: unknown, type: T, what: string): Static<T> {
  if (!compile(type).Check(value))
    throw new Error(`${what} answered ${JSON.stringify(value)?.slice(0, 160)}`);

  return value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`skipped, needs ${what}`);

  return value;
}

async function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  const late = Promise.withResolvers<never>();
  const timer = setTimeout(() => late.reject(new Error(`${what} took over ${String(ms)} ms`)), ms);

  try {
    return await Promise.race([promise, late.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function step(check: string, via: string, body: () => Promise<string>): Promise<void> {
  await obtain(check, via, async () => ({ result: await body(), value: true }));
}

async function obtain<T>(
  check: string,
  via: string,
  body: () => Promise<Passed<T>>,
): Promise<T | undefined> {
  const started = performance.now();

  const outcome = await body().then(
    (passed) => ({ ok: true, result: passed.result, value: passed.value }),
    (cause: unknown) => ({ ok: false, result: message(cause), value: undefined }),
  );

  rows.push({
    check,
    via,
    ok: outcome.ok,
    result: outcome.result,
    ms: Math.round(performance.now() - started),
  });

  return outcome.value;
}

function printTable(table: readonly Row[]): void {
  const header = ["check", "via", "result", "ms"];

  const cells = table.map((row) => [
    row.check,
    row.via,
    `${row.ok ? "ok" : "FAIL"} ${row.result}`.replace(/\s+/gu, " "),
    String(row.ms),
  ]);

  const widths = header.map((title, column) =>
    Math.max(title.length, ...cells.map((cell) => cell[column]?.length ?? 0)),
  );

  const line = (cell: readonly string[]): string =>
    `| ${cell.map((text, column) => (column === 3 ? text.padStart(widths[column] ?? 0) : text.padEnd(widths[column] ?? 0))).join(" | ")} |`;

  process.stdout.write(
    `${[line(header), line(widths.map((width) => "-".repeat(width))), ...cells.map(line)].join("\n")}\n`,
  );
}

function describeExit(exit: Exit): string {
  return exit.signal === null ? `with status ${String(exit.code)}` : `on ${exit.signal}`;
}

function tail(chunks: readonly string[]): string {
  return chunks.join("").trim().split("\n").slice(-3).join(" ").slice(0, 300);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
