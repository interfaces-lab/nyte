import { Buffer } from "node:buffer";
import { Type } from "typebox";
import { compile, isJson } from "@nyte-ai/schema";
import { allowsRedirect, namesMetadataDocument } from "./client-metadata.ts";
import type { ClientDirectory } from "./client-metadata.ts";
import type { McpClient, McpGrants, McpIssue } from "./grants.ts";

export const MCP_PATH = "/mcp";

const RESOURCE_METADATA = "/.well-known/oauth-protected-resource";

const SERVER_METADATA = "/.well-known/oauth-authorization-server";

const REGISTER = "/oauth/register";

const AUTHORIZE = "/oauth/authorize";

const SIGN_IN_STATE = "/oauth/authorize/state";

const TOKEN = "/oauth/token";

const MAX_FORM_BYTES = 64 * 1024;

export const READ_SCOPE = "nyte:read";

export const WRITE_SCOPE = "nyte:write";

const SCOPES = [READ_SCOPE, WRITE_SCOPE];

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const registration = compile(
  Type.Object({
    redirect_uris: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
    client_name: Type.Optional(Type.String({ maxLength: 200 })),
    application_type: Type.Optional(Type.String()),
    token_endpoint_auth_method: Type.Optional(Type.String()),
    grant_types: Type.Optional(Type.Array(Type.String())),
    response_types: Type.Optional(Type.Array(Type.String())),
  }),
);

const clientRecord = compile(
  Type.Object({ name: Type.String(), redirect_uris: Type.Array(Type.String()) }),
);

export function mcpResource(url: URL): string {
  return `${url.origin}${MCP_PATH}`;
}

export function resourceMetadataUrl(url: URL): string {
  return `${url.origin}${RESOURCE_METADATA}`;
}

export async function serveOAuth(
  request: Request,
  grants: McpGrants,
  clients: ClientDirectory,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === RESOURCE_METADATA || path === `${RESOURCE_METADATA}${MCP_PATH}`)
    return request.method === "GET" ? json(200, resourceMetadata(url)) : notAllowed("GET");

  if (path === SERVER_METADATA || path === `${SERVER_METADATA}${MCP_PATH}`)
    return request.method === "GET" ? json(200, serverMetadata(url)) : notAllowed("GET");

  if (path === REGISTER) return request.method === "POST" ? register(request) : notAllowed("POST");

  if (path === AUTHORIZE)
    return request.method === "GET" ? authorize(url, grants, clients) : notAllowed("GET");

  if (path === SIGN_IN_STATE)
    return request.method === "GET" ? signInState(url, grants) : notAllowed("GET");

  if (path === TOKEN)
    return request.method === "POST" ? token(request, grants, clients) : notAllowed("POST");

  return null;
}

function resourceMetadata(url: URL) {
  return {
    resource: mcpResource(url),
    authorization_servers: [url.origin],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES,
    resource_name: "Nyte host",
  };
}

function serverMetadata(url: URL) {
  return {
    issuer: url.origin,
    authorization_endpoint: `${url.origin}${AUTHORIZE}`,
    token_endpoint: `${url.origin}${TOKEN}`,
    registration_endpoint: `${url.origin}${REGISTER}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

async function register(request: Request): Promise<Response> {
  const text = await readLimited(request);
  const value = text === null ? null : readJson(text);

  if (!registration.Check(value))
    return oauthError(
      400,
      "invalid_client_metadata",
      "Send redirect_uris and an optional client_name.",
    );

  if (value.application_type !== "native" && value.application_type !== "web")
    return oauthError(
      400,
      "invalid_client_metadata",
      "Send application_type: native for a client on this machine, web for a remote one. Dynamic registration is deprecated; a Client ID Metadata Document needs no registration.",
    );

  if (value.token_endpoint_auth_method !== undefined && value.token_endpoint_auth_method !== "none")
    return oauthError(
      400,
      "invalid_client_metadata",
      "This host registers public clients only: token_endpoint_auth_method must be none.",
    );

  if (
    value.grant_types?.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")
  )
    return oauthError(
      400,
      "invalid_client_metadata",
      "This host grants authorization_code and refresh_token only.",
    );

  if (value.response_types?.some((type) => type !== "code"))
    return oauthError(400, "invalid_client_metadata", "This host answers response_type code only.");
  const web = value.application_type === "web";
  const unsafe = value.redirect_uris.find(
    (uri) => !allowsRedirect(uri) || (web && new URL(uri).protocol !== "https:"),
  );

  if (unsafe !== undefined)
    return oauthError(
      400,
      "invalid_redirect_uri",
      web
        ? `${unsafe} isn't an https URL, which a web client needs.`
        : `${unsafe} isn't an https URL or an http URL on localhost, 127.0.0.1 or [::1].`,
    );
  const name = value.client_name ?? "An unnamed MCP client";

  const id = Buffer.from(
    JSON.stringify({ name, redirect_uris: value.redirect_uris }),
    "utf8",
  ).toString("base64url");

  return json(201, {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: value.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: value.application_type,
  });
}

async function authorize(url: URL, grants: McpGrants, clients: ClientDirectory): Promise<Response> {
  const params = url.searchParams;
  const client = await findClient(params.get("client_id") ?? "", clients);

  if (client === null)
    return page(
      400,
      "Unknown MCP client",
      "The client ID is neither a metadata document this host could fetch and accept nor one it registered.",
    );

  const redirectUri =
    params.get("redirect_uri") ??
    (client.redirectUris.length === 1 ? client.redirectUris[0] : null);

  if (
    redirectUri === null ||
    redirectUri === undefined ||
    !client.redirectUris.includes(redirectUri)
  )
    return page(400, "Unknown redirect URI", "The redirect URI isn't one the client registered.");
  const state = params.get("state");
  const issuer = url.origin;

  const back = (error: string, description: string): Response =>
    redirectError(redirectUri, { error, description, state, issuer });

  if (params.get("response_type") !== "code")
    return back("unsupported_response_type", "This host answers response_type code only.");
  const challenge = params.get("code_challenge");

  if (
    challenge === null ||
    !CHALLENGE.test(challenge) ||
    params.get("code_challenge_method") !== "S256"
  )
    return back("invalid_request", "This host requires PKCE with code_challenge_method S256.");
  const resources = params.getAll("resource");
  const resource = mcpResource(url);

  if (resources.length !== 1 || resources[0] !== resource)
    return back("invalid_target", `Ask for the resource ${resource}.`);

  const asked = grants.ask({
    client,
    redirectUri,
    state,
    challenge,
    resource,
    issuer,
    scope: params.get("scope"),
  });

  return consentPage({
    client: client.name,
    clientId: namesMetadataDocument(client.id) ? client.id : null,
    scope: params.get("scope"),
    destination: new URL(redirectUri).host,
    request: asked.id,
    code: asked.code,
  });
}

function signInState(url: URL, grants: McpGrants): Response {
  const state = grants.signInState(url.searchParams.get("request") ?? "");

  if (state.kind === "expired") return json(404, { state: "expired" });

  if (state.kind === "pending") return json(200, { state: "pending" });

  return json(200, { state: "decided", location: state.location });
}

async function token(
  request: Request,
  grants: McpGrants,
  clients: ClientDirectory,
): Promise<Response> {
  const text = await readLimited(request);

  if (text === null) return oauthError(400, "invalid_request", "The form is too large.");
  const form = new URLSearchParams(text);
  const resources = form.getAll("resource");

  if (resources.length > 1)
    return oauthError(400, "invalid_target", "Ask for one resource, the /mcp URL.");
  const resource = resources[0] ?? null;
  const grant = form.get("grant_type");
  const clientId = form.get("client_id");

  if (clientId === null || (await findClient(clientId, clients)) === null)
    return oauthError(401, "invalid_client", "Send the client_id this host registered.");

  if (grant === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const verifier = form.get("code_verifier");

    if (code === null || redirectUri === null || verifier === null)
      return oauthError(400, "invalid_request", "Send code, redirect_uri and code_verifier.");

    return issued(await grants.exchange({ code, clientId, redirectUri, verifier, resource }));
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token");

    if (refresh === null) return oauthError(400, "invalid_request", "Send refresh_token.");

    return issued(await grants.refresh({ token: refresh, clientId, resource }));
  }

  return oauthError(
    400,
    "unsupported_grant_type",
    "This host grants authorization_code and refresh_token only.",
  );
}

function issued(issue: McpIssue): Response {
  if (issue.kind === "refused") return oauthError(400, issue.error, issue.description);

  return json(200, issue.tokens);
}

async function findClient(id: string, clients: ClientDirectory): Promise<McpClient | null> {
  if (namesMetadataDocument(id)) return clients.find(id);

  if (id === "" || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const text = Buffer.from(id, "base64url").toString("utf8");
  const value = readJson(text);

  if (!clientRecord.Check(value)) return null;

  return { id, name: value.name, redirectUris: value.redirect_uris };
}

function readJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    return isJson(value) ? value : null;
  } catch {
    return null;
  }
}

async function readLimited(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_FORM_BYTES) return null;
  const text = await request.text();

  return text.length > MAX_FORM_BYTES ? null : text;
}

function redirectError(
  redirectUri: string,
  input: {
    readonly error: string;
    readonly description: string;
    readonly state: string | null;
    readonly issuer: string;
  },
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", input.error);
  url.searchParams.set("error_description", input.description);

  if (input.state !== null) url.searchParams.set("state", input.state);
  url.searchParams.set("iss", input.issuer);

  return new Response(null, { status: 302, headers: { Location: url.href } });
}

function consentPage(input: {
  readonly client: string;
  readonly clientId: string | null;
  readonly scope: string | null;
  readonly destination: string;
  readonly request: string;
  readonly code: string;
}): Response {
  const identity =
    input.clientId === null
      ? "<p>The client registered itself here; its name is its own claim.</p>"
      : `<p>Client ID: <code>${escape(input.clientId)}</code></p>`;
  const body = `<h1>${escape(input.client)} wants to use this Nyte host</h1>
${identity}
<p>Access requested: ${escape(input.scope ?? "not named; you choose")}.</p>
<p>Approving sends access to ${escape(input.destination)}.</p>
<p>Code: <code id="code">${escape(input.code)}</code></p>
<p>On the host, approve with <code>mcp.approve</code> and this code, for read-only tools or for write tools under a permissions ceiling, or refuse with <code>mcp.deny</code>. This page continues when you decide.</p>
<p id="status" role="status">Waiting for the host's owner…</p>
<script>
const request = ${JSON.stringify(input.request)};
async function poll() {
  const answer = await fetch(${JSON.stringify(SIGN_IN_STATE)} + "?request=" + encodeURIComponent(request), { cache: "no-store" });
  const state = await answer.json();
  if (state.state === "decided") return location.replace(state.location);
  if (state.state === "expired") return void (document.getElementById("status").textContent = "This sign-in expired. Start it again from the agent.");
  setTimeout(poll, 1000);
}
poll();
</script>`;

  return html(200, "Approve MCP access", body, input.request);
}

function page(status: number, title: string, message: string): Response {
  return html(status, title, `<h1>${escape(title)}</h1>\n<p>${escape(message)}</p>`, null);
}

function html(status: number, title: string, body: string, request: string | null): Response {
  const marker = request === null ? "" : ` data-request="${escape(request)}"`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem}#code{font-size:1.5rem;letter-spacing:.1em}</style>
</head>
<body${marker}>
${body}
</body>
</html>
`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
      },
    },
  );
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function oauthError(status: number, error: string, description: string): Response {
  return json(status, { error, error_description: description });
}

function notAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { Allow: allow } });
}
