import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { compile } from "@nyte-ai/schema";
import { memoryStore } from "@nyte-ai/core/store";
import type { Host, Listener } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { openHost } from "../src/index.ts";
import { fetchClientMetadata } from "../src/mcp-server/client-metadata.ts";
import type { ClientMetadataFetch } from "../src/mcp-server/client-metadata.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const TOKEN = "a-token-of-16-chars";

const ORIGIN = "http://127.0.0.1:4100";

const RESOURCE = `${ORIGIN}/mcp`;

const REDIRECT = "http://127.0.0.1:9999/callback";

const TOOL_LIST = Type.Object({
  result: Type.Object({
    tools: Type.Array(Type.Object({ name: Type.String(), annotations: Type.Unknown() })),
  }),
});

type Opened = {
  readonly host: Host;
  readonly http: Listener;
  readonly local: Listener;
};

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(fetchDocument?: ClientMetadataFetch): Promise<Opened> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-mcp-server-")));
  cleanups.push(() => rm(home, { recursive: true, force: true }));

  const host = await openHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home,
    fetchClientMetadata: fetchDocument,
  });

  cleanups.push(() => host.close());
  const auth = { kind: "token", token: TOKEN } as const;
  const http = await host.listen({ transport: { kind: "fetch" }, auth });

  const local = await host.listen({
    transport: { kind: "socket", path: join(home, "host.sock") },
    auth,
    execution: { kind: "admit-only" },
  });

  return { host, http, local };
}

async function read<T extends TSchema>(response: Response, type: T): Promise<Static<T>> {
  const value: unknown = await response.json();

  if (!compile(type).Check(value)) throw new Error(`Unexpected body: ${JSON.stringify(value)}`);

  return value;
}

function get(listener: Listener, path: string): Promise<Response> {
  return listener.fetch(new Request(`${ORIGIN}${path}`));
}

function post(
  listener: Listener,
  path: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  return listener.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function owner(listener: Listener, name: string, body: unknown): Promise<Response> {
  return post(listener, `/${name}`, body, {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  });
}

async function register(listener: Listener, name = "Test agent"): Promise<string> {
  const response = await post(
    listener,
    "/oauth/register",
    { client_name: name, application_type: "native", redirect_uris: [REDIRECT] },
    { "Content-Type": "application/json" },
  );

  expect(response.status).toBe(201);

  return (await read(response, Type.Object({ client_id: Type.String() }))).client_id;
}

function pkce(): { readonly verifier: string; readonly challenge: string } {
  const verifier = randomBytes(32).toString("base64url");

  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeUrl(
  client: string,
  challenge: string | null,
  resource: string = RESOURCE,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client,
    redirect_uri: REDIRECT,
    state: "xyz",
    resource,
  });

  if (challenge !== null) {
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }

  return `/oauth/authorize?${params.toString()}`;
}

async function signIn(
  opened: Opened,
  access: { readonly kind: "read-only" } | { readonly kind: "ceiling"; readonly ceiling: string },
  registered?: string,
): Promise<{ readonly access: string; readonly refresh: string; readonly client: string }> {
  const client = registered ?? (await register(opened.http));
  const secret = pkce();
  const page = await get(opened.http, authorizeUrl(client, secret.challenge));

  expect(page.status).toBe(200);
  const html = await page.text();
  const request = /data-request="([^"]+)"/.exec(html)?.[1] ?? "";
  const code = /<code id="code">([^<]+)<\/code>/.exec(html)?.[1] ?? "";

  expect(html).toContain("Test agent");
  expect(
    await (await get(opened.http, `/oauth/authorize/state?request=${request}`)).json(),
  ).toEqual({ state: "pending" });

  const approved = await owner(opened.local, "mcp.approve", { code, access });

  expect(approved.status).toBe(200);
  expect(await approved.json()).toEqual({ client: "Test agent" });
  const state = await read(
    await get(opened.http, `/oauth/authorize/state?request=${request}`),
    Type.Object({ location: Type.String() }),
  );
  const location = new URL(state.location);

  expect(location.origin + location.pathname).toBe(REDIRECT);
  expect(location.searchParams.get("state")).toBe("xyz");
  expect(location.searchParams.get("iss")).toBe(ORIGIN);

  const exchanged = await post(
    opened.http,
    "/oauth/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      code: location.searchParams.get("code") ?? "",
      redirect_uri: REDIRECT,
      client_id: client,
      code_verifier: secret.verifier,
      resource: RESOURCE,
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
  );

  expect(exchanged.status).toBe(200);
  const tokens = await read(
    exchanged,
    Type.Object({
      token_type: Type.Literal("Bearer"),
      access_token: Type.String(),
      refresh_token: Type.String(),
    }),
  );

  return { access: tokens.access_token, refresh: tokens.refresh_token, client };
}

async function rpc(
  listener: Listener,
  token: string,
  method: string,
  params: unknown = {},
): Promise<Response> {
  const response = await post(
    listener,
    "/mcp",
    { jsonrpc: "2.0", id: 1, method, params },
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "127.0.0.1:4100",
    },
  );
  const text = await response.text();
  const frame = text.split("\n").findLast((line) => line.startsWith("data: "));

  return new Response(frame === undefined ? text : frame.slice("data: ".length), {
    status: response.status,
    headers: response.headers,
  });
}

describe.skipIf(process.platform === "win32")("the MCP server", () => {
  it("documents the protected resource and its authorization server, and challenges a bare /mcp", async () => {
    const opened = await open();
    const resource = await (await get(opened.http, "/.well-known/oauth-protected-resource")).json();

    expect(resource).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
    });

    const server = await (await get(opened.http, "/.well-known/oauth-authorization-server")).json();

    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      scopes_supported: ["nyte:read", "nyte:write"],
    });

    const local = { "Content-Type": "application/json", Host: "127.0.0.1:4100" };
    const bare = await post(opened.http, "/mcp", {}, local);

    expect(bare.status).toBe(401);
    expect(bare.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
    expect(bare.headers.get("WWW-Authenticate")).toContain('scope="nyte:read"');

    const listener = await post(
      opened.http,
      "/mcp",
      {},
      { ...local, Authorization: `Bearer ${TOKEN}` },
    );

    expect(listener.status).toBe(401);

    const rebound = await post(opened.http, "/mcp", {}, { ...local, Host: "attacker.example" });

    expect(rebound.status).toBe(403);
  });

  it("registers public clients only", async () => {
    const opened = await open();
    const client = await register(opened.http);

    expect(client).not.toBe("");

    const confidential = await post(
      opened.http,
      "/oauth/register",
      {
        client_name: "Secretive",
        application_type: "native",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "client_secret_basic",
      },
      { "Content-Type": "application/json" },
    );

    expect(confidential.status).toBe(400);
    expect(await confidential.json()).toMatchObject({ error: "invalid_client_metadata" });

    const plain = await post(
      opened.http,
      "/oauth/register",
      { application_type: "native", redirect_uris: ["http://example.com/callback"] },
      { "Content-Type": "application/json" },
    );

    expect(await plain.json()).toMatchObject({ error: "invalid_redirect_uri" });

    const untyped = await post(
      opened.http,
      "/oauth/register",
      { client_name: "Untyped", redirect_uris: [REDIRECT] },
      { "Content-Type": "application/json" },
    );

    expect(untyped.status).toBe(400);
    expect(await untyped.json()).toMatchObject({ error: "invalid_client_metadata" });

    const web = await post(
      opened.http,
      "/oauth/register",
      { client_name: "Web", application_type: "web", redirect_uris: [REDIRECT] },
      { "Content-Type": "application/json" },
    );

    expect(await web.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("signs in a client by its metadata document", async () => {
    const clientId = "https://client.example/oauth/metadata.json";
    const fetched: string[] = [];

    const opened = await open(async (url) => {
      fetched.push(url.href);

      return {
        status: 200,
        cacheControl: "max-age=300",
        expires: null,
        body: JSON.stringify({
          client_id: clientId,
          client_name: "Test agent",
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "none",
        }),
      };
    });

    const page = await get(opened.http, authorizeUrl(clientId, pkce().challenge));

    expect(await page.text()).toContain(`Client ID: <code>${clientId}</code>`);

    const tokens = await signIn(opened, { kind: "read-only" }, clientId);

    expect((await rpc(opened.http, tokens.access, "tools/list")).status).toBe(200);
    expect(fetched).toEqual([clientId]);

    const elsewhere = await get(
      opened.http,
      authorizeUrl(clientId, pkce().challenge).replace(
        encodeURIComponent(REDIRECT),
        encodeURIComponent("http://127.0.0.1:9999/other"),
      ),
    );

    expect(elsewhere.status).toBe(400);
  });

  it("refuses a metadata document whose client_id is another URL", async () => {
    const opened = await open(async () => ({
      status: 200,
      cacheControl: null,
      expires: null,
      body: JSON.stringify({
        client_id: "https://client.example/other.json",
        client_name: "Impostor",
        redirect_uris: [REDIRECT],
      }),
    }));
    const page = await get(
      opened.http,
      authorizeUrl("https://client.example/oauth/metadata.json", pkce().challenge),
    );

    expect(page.status).toBe(400);
    expect(await page.text()).toContain("Unknown MCP client");
  });

  it("fetches no metadata document from a loopback or private address", async () => {
    for (const url of [
      "https://127.0.0.1/client.json",
      "https://[::1]/client.json",
      "https://10.1.2.3/client.json",
      "https://localhost/client.json",
    ])
      await expect(fetchClientMetadata(new URL(url))).rejects.toThrow(/does not fetch from/);
  });

  it("refuses an authorization without PKCE or for another resource", async () => {
    const opened = await open();
    const client = await register(opened.http);
    const secret = pkce();

    const cases = [
      { url: authorizeUrl(client, null), error: "invalid_request" },
      {
        url: authorizeUrl(client, secret.challenge, "http://127.0.0.1:4100/other"),
        error: "invalid_target",
      },
    ];

    for (const entry of cases) {
      const response = await get(opened.http, entry.url);

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");

      expect(location.searchParams.get("error")).toBe(entry.error);
      expect(location.searchParams.get("iss")).toBe(ORIGIN);
      expect(location.searchParams.get("state")).toBe("xyz");
    }
  });

  it("issues a token once the owner approves, and its tools run the table's operations", async () => {
    const opened = await open();
    await opened.host.sessions.start({ name: "Seed", content: "Hi." });

    const client = await register(opened.http);
    const page = await get(opened.http, authorizeUrl(client, pkce().challenge));
    const code = /<code id="code">([^<]+)<\/code>/.exec(await page.text())?.[1] ?? "";
    const remote = await owner(opened.http, "mcp.approve", { code, access: { kind: "read-only" } });

    expect(remote.status).toBe(403);

    const tokens = await signIn(opened, { kind: "ceiling", ceiling: "full" });
    const opening = await opened.http.fetch(
      new Request(`${ORIGIN}/mcp`, {
        headers: { Authorization: `Bearer ${tokens.access}`, Host: "127.0.0.1:4100" },
      }),
    );

    expect(opening.status).toBe(405);
    const initialized = await rpc(opened.http, tokens.access, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });

    expect(await initialized.json()).toMatchObject({
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nyte" },
      },
    });

    const listed = await read(await rpc(opened.http, tokens.access, "tools/list"), TOOL_LIST);

    expect(listed.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["sessions_list", "sessions_start"]),
    );

    const called = await read(
      await rpc(opened.http, tokens.access, "tools/call", {
        name: "sessions_list",
        arguments: { limit: 10 },
      }),
      Type.Object({
        result: Type.Object({
          isError: Type.Optional(Type.Boolean()),
          content: Type.Array(Type.Object({ type: Type.Literal("text"), text: Type.String() })),
          structuredContent: Type.Object({ items: Type.Array(Type.Unknown()) }),
        }),
      }),
    );

    expect(called.result.isError).toBeUndefined();
    expect(called.result.structuredContent.items).toHaveLength(1);
    expect(called.result.content.map((entry) => JSON.parse(entry.text))).toEqual([
      called.result.structuredContent,
    ]);

    const grants = await owner(opened.local, "mcp.grants.list", {});

    expect(await grants.json()).toEqual([
      expect.objectContaining({
        client: "Test agent",
        access: { kind: "ceiling", ceiling: "full" },
      }),
    ]);
  });

  it("answers a 2026-07-28 request with the grant's tools", async () => {
    const opened = await open();
    const tokens = await signIn(opened, { kind: "read-only" });
    const response = await post(
      opened.http,
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      {
        Authorization: `Bearer ${tokens.access}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "127.0.0.1:4100",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
    );

    expect(response.status).toBe(200);
    const listed = await read(response, TOOL_LIST);

    expect(listed.result.tools.map((tool) => tool.name)).toContain("sessions_list");
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain("sessions_start");
  });

  it("keeps a read-only grant to read tools", async () => {
    const opened = await open();
    const tokens = await signIn(opened, { kind: "read-only" });
    const listed = await read(await rpc(opened.http, tokens.access, "tools/list"), TOOL_LIST);
    const tools = listed.result.tools;

    expect(tools.map((tool) => tool.name)).toContain("sessions_list");
    expect(tools.map((tool) => tool.name)).not.toContain("sessions_start");
    expect(tools.map((tool) => tool.annotations)).toEqual(
      tools.map(() => ({ readOnlyHint: true })),
    );

    const called = await rpc(opened.http, tokens.access, "tools/call", {
      name: "sessions_start",
      arguments: { id: "s1", content: "Hi." },
    });

    expect(await called.json()).toMatchObject({ error: { code: -32602 } });
    expect(await opened.host.sessions.list({ limit: 10 })).toMatchObject({ items: [] });
  });

  it("refuses a revoked token", async () => {
    const opened = await open();
    const tokens = await signIn(opened, { kind: "read-only" });

    expect((await rpc(opened.http, tokens.access, "tools/list")).status).toBe(200);
    const grants = await read(
      await owner(opened.local, "mcp.grants.list", {}),
      Type.Array(Type.Object({ id: Type.String() })),
    );
    const revoked = await owner(opened.local, "mcp.grants.revoke", { id: grants[0]?.id });

    expect(revoked.status).toBe(200);
    const refused = await rpc(opened.http, tokens.access, "tools/list");

    expect(refused.status).toBe(401);
    expect(refused.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');

    const refreshed = await post(
      opened.http,
      "/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh,
        client_id: tokens.client,
      }).toString(),
      { "Content-Type": "application/x-www-form-urlencoded" },
    );

    expect(refreshed.status).toBe(400);
  });

  it("refuses an MCP token on every other route", async () => {
    const opened = await open();
    const tokens = await signIn(opened, { kind: "read-only" });
    const response = await post(
      opened.http,
      "/sessions.list",
      {},
      { Authorization: `Bearer ${tokens.access}`, "Content-Type": "application/json" },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "denied" });
  });
});
