import { Type } from "typebox";
import {
  ApprovalPolicyType,
  asId,
  compile,
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
import { PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
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
import { mcpResource, resourceMetadataUrl } from "./oauth.ts";

type Tool = {
  readonly name: string;
  readonly operation: CallName;
  readonly access: "read" | "write";
  readonly description: string;
  readonly inputSchema: Json;
};

type Bound = {
  readonly connection: Connection;
  readonly binding: CallBinding;
  dispose(): void;
};

type Message = {
  readonly id: string | number | null;
  readonly method: string;
  readonly params: JsonSchema;
};

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const PARTICIPANT: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const rows: { readonly [name: string]: Declaration<unknown, unknown> } = OPERATIONS;

const policyCheck = compile(ApprovalPolicyType);

const POLICIES = ApprovalPolicyType.anyOf.map((literal) => literal.const);

const messageCheck = compile(
  Type.Object({
    jsonrpc: Type.Literal("2.0"),
    id: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    method: Type.String(),
    params: Type.Optional(Type.Unknown()),
  }),
);

/** Every marked row the wire answers once, as an MCP tool: its name with `.` as `_`, its summary and its wire input JSON Schema. */
const TOOLS: readonly Tool[] = describeOperations().flatMap((description) => {
  const name = description.name;
  const access = rows[name]?.mcp;

  if (access === undefined || !namesOperation(name) || !answersOnce(name)) return [];

  return [
    {
      name: name.replaceAll(".", "_"),
      operation: name,
      access,
      description: description.summary,
      inputSchema: description.input,
    },
  ];
});

/** Serves `/mcp` over streamable HTTP (MCP 2025-06-18) without sessions: a bearer token the grants issued for this URL, then one JSON-RPC request per POST, answered with JSON; GET and DELETE answer 405. A tool call runs its operation as the grant's principal, `mcp:<grant>`, with participant authority. */
export function createMcpEndpoint(options: {
  readonly server: ServerHost;
  readonly grants: McpGrants;
  readonly version: string;
}): { serve(request: Request): Promise<Response> } {
  const bound = new Map<string, Bound>();

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
    params: JsonSchema,
    signal: AbortSignal,
  ): Promise<Json | null> => {
    const tool = TOOLS.find((candidate) => candidate.name === params.name);

    if (tool === undefined || !allows(grant, tool)) return null;
    const started = Date.now();
    const value = params.arguments ?? {};

    const result = await run(bind(grant), grant, tool, value, signal).then(
      (output): Json => ({
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: isJsonObject(output) ? output : { result: output },
      }),
      (error: unknown): Json => ({
        content: [{ type: "text", text: asSdkError(error).message }],
        isError: true,
      }),
    );

    dev("mcp", "tool", {
      tool: tool.name,
      grant: grant.id,
      client: grant.client,
      error: isJsonObject(result) && result.isError === true,
      ms: Date.now() - started,
    });

    return result;
  };

  const answer = async (grant: McpGrant, message: Message, signal: AbortSignal): Promise<Json> => {
    if (message.method === "initialize") {
      const asked = message.params.protocolVersion;

      return reply(message.id, {
        protocolVersion:
          typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nyte", title: "Nyte host", version: options.version },
        instructions:
          "Tools read and steer the sessions on this Nyte host. Each tool is one host operation.",
      });
    }

    if (message.method === "ping") return reply(message.id, {});

    if (message.method === "tools/list")
      return reply(message.id, {
        tools: TOOLS.filter((tool) => allows(grant, tool)).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.access === "read" },
        })),
      });

    if (message.method === "tools/call") {
      const result = await call(grant, message.params, signal);

      if (result === null)
        return failure(
          message.id,
          -32602,
          `No tool named ${JSON.stringify(message.params.name ?? null)} is open to this grant.`,
        );

      return reply(message.id, result);
    }

    return failure(message.id, -32601, `This server does not answer ${message.method}.`);
  };

  const serve = async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const url = new URL(request.url);
    const header = request.headers.get("Authorization") ?? "";
    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];

    const grant =
      token === undefined ? null : await options.grants.authenticate(token, mcpResource(url));

    if (grant === null) return challenge(url, token !== undefined);
    const value = readJson(await request.text());

    if (value === undefined) return json(400, failure(null, -32700, "The body is not JSON."));

    if (!messageCheck.Check(value))
      return json(400, failure(null, -32600, "Send one JSON-RPC 2.0 message."));

    if (value.id === undefined) return new Response(null, { status: 202 });
    const params = isJson(value.params) ? value.params : {};

    if (!isJsonObject(params))
      return json(400, failure(value.id, -32602, "The params are not a JSON object."));

    return json(
      200,
      await answer(grant, { id: value.id, method: value.method, params }, request.signal),
    );
  };

  return { serve };
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

  if (tool.access === "write" && grant.access.kind === "ceiling") {
    const policy = await hostPolicy(bound.connection);

    if (POLICIES.indexOf(policy) > POLICIES.indexOf(grant.access.ceiling))
      throw new SdkError(
        "denied",
        `The host's permissions are ${policy}, above this grant's ceiling of ${grant.access.ceiling}, so it may not start or steer work.`,
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

async function hostPolicy(connection: Connection) {
  const iterator = connection.watch()[Symbol.asyncIterator]();
  const first = await iterator.next();
  await iterator.return?.();

  if (first.done === true) return "full" as const;
  const value = first.value.settings.find((setting) => setting.id === PERMISSIONS)?.value;

  return policyCheck.Check(value) ? value : ("full" as const);
}

function allows(grant: McpGrant, tool: Tool): boolean {
  return tool.access === "read" || grant.access.kind === "ceiling";
}

function challenge(url: URL, given: boolean): Response {
  const error = given ? ', error="invalid_token"' : "";

  return new Response(JSON.stringify({ error: given ? "invalid_token" : "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(url)}"${error}`,
    },
  });
}

function readJson(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return isJson(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function reply(id: string | number | null, result: Json): Json {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: string | number | null, code: number, message: string): Json {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function json(status: number, value: Json): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
