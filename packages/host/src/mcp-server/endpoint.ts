import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import type {
  AuthInfo,
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import {
  asId,
  describeOperations,
  isJson,
  isJsonObject,
  OPERATIONS,
  SdkError,
} from "@nyte-ai/schema";
import type { Authority, Declaration, Json, JsonSchema } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import type { ServerHost } from "@nyte-ai/core/server";
import {
  answersOnce,
  asSdkError,
  decodeInput,
  encodeOutput,
  namesOperation,
} from "@nyte-ai/protocol";
import type { CallName } from "@nyte-ai/protocol";
import { bindConnection } from "../serve/binding.ts";
import type { CallBinding } from "../serve/binding.ts";
import type { McpGrant, McpGrants } from "./grants.ts";
import { mcpResource, READ_SCOPE, resourceMetadataUrl, WRITE_SCOPE } from "./oauth.ts";

type Tool = {
  readonly name: string;
  readonly operation: CallName;
  readonly access: "read" | "write";
  readonly description: string;
  readonly inputSchema: JsonSchema;
};

type Bound = {
  readonly connection: Connection;
  readonly binding: CallBinding;
  dispose(): void;
};

const PARTICIPANT: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const rows: { readonly [name: string]: Declaration<unknown, unknown> } = OPERATIONS;

const INSTRUCTIONS =
  "Tools read and steer the sessions on this Nyte host. Each tool is one host operation.";

/** Every marked row the wire answers once, as an MCP tool: its name with `.` as `_`, its summary and its wire input JSON Schema. */
const TOOLS: readonly Tool[] = describeOperations().flatMap((description) => {
  const name = description.name;
  const access = rows[name]?.mcp;
  const input = description.input;

  if (access === undefined || !namesOperation(name) || !answersOnce(name)) return [];

  if (!isJsonObject(input)) return [];

  return [
    {
      name: name.replaceAll(".", "_"),
      operation: name,
      access,
      description: description.summary,
      inputSchema: input,
    },
  ];
});

/** Serves `/mcp` through the MCP SDK's `createMcpHandler`: 2026-07-28 requests per request, and 2025-era requests through its stateless fallback. Host and Origin are checked first, then the bearer token, which must be one the grants issued for this URL; the per-request server lists only the tools the grant may call. A tool call runs its operation as the grant's principal, `mcp:<grant>`, with participant authority. */
export function createMcpEndpoint(options: {
  readonly server: ServerHost;
  readonly grants: McpGrants;
  readonly version: string;
}): { serve(request: Request, origins: readonly string[]): Promise<Response> } {
  const bound = new Map<string, Bound>();
  const callers = new WeakMap<AuthInfo, McpGrant>();

  const forget = (grant: string): void => {
    const known = bound.get(grant);
    bound.delete(grant);
    known?.dispose();
    void known?.connection.close();
  };

  const bind = (grant: McpGrant): Bound => {
    const known = bound.get(grant.id);

    if (known !== undefined) return known;
    const principal = asId<"principal">(`mcp:${grant.id}`);

    const connection = options.server.connect({
      principal,
      authority: PARTICIPANT,
      credential: { kind: "token", token: "" },
      origin: null,
      ...(grant.access.kind === "ceiling"
        ? { mcp: { grant: grant.id, ceiling: grant.access.ceiling } }
        : {}),
    });

    const admitted = options.server.connections.register(principal, () => forget(grant.id));

    if (admitted.kind === "revoked") {
      void connection.close();

      throw new SdkError("unauthenticated", "This MCP grant was revoked.");
    }

    const created: Bound = {
      connection,
      binding: bindConnection(connection, { server: options.server }),
      dispose: admitted.dispose,
    };

    bound.set(grant.id, created);

    return created;
  };

  const call = async (
    grant: McpGrant,
    tool: Tool,
    value: Json,
    signal: AbortSignal,
  ): Promise<CallToolResult> => {
    const started = Date.now();

    const result = await run(bind(grant), grant, tool, value, signal).then(
      (output): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: isJsonObject(output) ? output : { result: output },
      }),
      (error: unknown): CallToolResult => ({
        content: [{ type: "text", text: asSdkError(error).message }],
        isError: true,
      }),
    );

    dev("mcp", "tool", {
      tool: tool.name,
      grant: grant.id,
      client: grant.client,
      error: result.isError === true,
      ms: Date.now() - started,
    });

    return result;
  };

  const build = (grant: McpGrant | undefined): McpServer => {
    const server = new McpServer(
      { name: "nyte", title: "Nyte host", version: options.version },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );

    if (grant === undefined) return server;

    const tools = TOOLS.filter(
      (candidate) => candidate.access === "read" || grant.access.kind === "ceiling",
    );

    for (const tool of tools)
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: toolSchema(tool),
          annotations: { readOnlyHint: tool.access === "read" },
        },
        (value, context) => call(grant, tool, value, context.mcpReq.signal),
      );

    return server;
  };

  const handler = createMcpHandler((context) =>
    build(context.authInfo === undefined ? undefined : callers.get(context.authInfo)),
  );

  const serve = async (request: Request, origins: readonly string[]): Promise<Response> => {
    const url = new URL(request.url);
    const allowed = origins.flatMap((origin) =>
      URL.canParse(origin) ? [new URL(origin).hostname] : [],
    );

    const rejected =
      hostHeaderValidationResponse(request, [...localhostAllowedHostnames(), ...allowed]) ??
      originValidationResponse(request, [...localhostAllowedOrigins(), ...allowed]);

    if (rejected !== undefined) return rejected;
    const resource = mcpResource(url);
    const found: { grant?: McpGrant } = {};

    const gate = requireBearerAuth({
      verifier: {
        verifyAccessToken: async (token) => {
          const grant = await options.grants.authenticate(token, resource);

          if (grant === null)
            throw new OAuthError(
              OAuthErrorCode.InvalidToken,
              "The token is unknown, revoked or expired.",
            );
          found.grant = grant;

          return {
            token,
            clientId: grant.client,
            scopes: grant.access.kind === "read-only" ? [READ_SCOPE] : [READ_SCOPE, WRITE_SCOPE],
            expiresAt: Math.floor(grant.expiresAt / 1000),
            resource: new URL(grant.resource),
          };
        },
      },
      expectedResource: new URL(resource),
      requiredScopes: [READ_SCOPE],
      resourceMetadataUrl: resourceMetadataUrl(url),
    });

    const authInfo = await gate(request);

    if (authInfo instanceof Response) return authInfo;

    if (found.grant !== undefined) callers.set(authInfo, found.grant);

    return handler.fetch(request, { authInfo });
  };

  return { serve };
}

function toolSchema(tool: Tool): StandardSchemaWithJSON<Json, Json> {
  return {
    "~standard": {
      version: 1,
      vendor: "nyte",
      validate: (value) =>
        isJson(value) ? { value } : { issues: [{ message: "The arguments are not JSON." }] },
      jsonSchema: { input: () => tool.inputSchema, output: () => tool.inputSchema },
    },
  };
}

async function run(
  bound: Bound,
  grant: McpGrant,
  tool: Tool,
  value: Json,
  signal: AbortSignal,
): Promise<Json> {
  const row = OPERATIONS[tool.operation];

  if (!PARTICIPANT.has(row.authority))
    throw new SdkError("denied", `${tool.operation} needs ${row.authority} authority.`);

  const target = isJsonObject(value) ? value.session : undefined;

  if (tool.access === "write" && typeof target === "string") {
    const owner = (await bound.connection.session(asId<"session">(target)).info()).mcp?.grant;

    if (owner !== grant.id)
      throw new SdkError(
        "denied",
        `Session ${target} wasn't started through this MCP grant, so it may not steer or stop it.`,
      );
  }

  return callOperation(bound.binding, tool.operation, value, signal);
}

async function callOperation<N extends CallName>(
  binding: CallBinding,
  name: N,
  value: Json,
  signal: AbortSignal,
): Promise<Json> {
  return encodeOutput(name, await binding[name](decodeInput(name, value), { body: null, signal }));
}
