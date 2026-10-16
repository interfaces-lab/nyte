import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isJsonObject, McpExposureNameType, McpOAuthConfigType } from "@nyte-ai/schema";
import { isJson } from "@nyte-ai/schema";
import type {
  Json,
  McpChange,
  McpExposure,
  McpOAuthConfig,
  McpScope,
  ValidationIssue,
} from "@nyte-ai/schema";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const ExposureName = McpExposureNameType;

const Entry = Type.Object({
  type: Type.Optional(Type.Enum(["stdio", "http", "streamable-http", "sse"])),
  command: Type.Optional(Type.String({ minLength: 1 })),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  cwd: Type.Optional(Type.String()),
  url: Type.Optional(Type.String({ minLength: 1 })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  oauth: Type.Optional(McpOAuthConfigType),
  enabled: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  description: Type.Optional(Type.String()),
  exposure: Type.Optional(ExposureName),
  toolExposure: Type.Optional(Type.Record(Type.String(), ExposureName)),
});

const ConfigFile = Type.Object({
  mcpServers: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const OVERRIDE_KEYS = new Set(["enabled", "exposure", "toolExposure"]);

const EXPOSURE: Readonly<Record<Static<typeof ExposureName>, McpExposure>> = {
  direct: "model",
  deferred: "deferred",
  codemode: "code",
  "codemode-deferred": "code",
  hidden: "hidden",
};

type McpTransportConfig =
  | {
      readonly kind: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
      readonly cwd: string | null;
    }
  | {
      readonly kind: "http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly oauth: McpOAuthConfig;
    };

export type McpServerEntry = {
  readonly name: string;
  readonly scope: McpScope;
  readonly path: string;
  readonly override: string | null;
  readonly transport: McpTransportConfig;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly description: string | null;
  readonly exposure: McpExposure;
  /** Patterns in file order; `*` matches any characters. */
  readonly toolExposure: readonly (readonly [pattern: string, exposure: McpExposure])[];
};

export type McpFileContents =
  | { readonly kind: "missing" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unreadable"; readonly message: string };

export type McpFile = {
  readonly path: string;
  readonly scope: McpScope;
  readonly contents: McpFileContents;
};

export type McpConfig = {
  readonly servers: ReadonlyMap<string, McpServerEntry>;
  readonly issues: readonly ValidationIssue[];
};

/** Reads one `mcp.json`; a file that cannot be read is `unreadable`, not missing. */
export async function readMcpFile(path: string): Promise<McpFileContents> {
  try {
    return { kind: "text", text: await readFile(path, "utf8") };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { kind: "missing" };

    return { kind: "unreadable", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Merges the user file and then the project file into one server list. A
 * project entry replaces the user entry of the same name; one with only
 * `enabled`, `exposure` or `toolExposure` overrides those fields instead.
 * An invalid entry becomes an issue and is left out.
 */
export function parseMcpConfig(files: readonly McpFile[]): McpConfig {
  const servers = new Map<string, McpServerEntry>();
  const canonical = new Map<string, string>();
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    if (file.contents.kind === "missing") continue;

    const fail = (path: readonly string[], message: string): void => {
      issues.push({
        severity: "error",
        path: ["mcpServers", ...path],
        message,
        source: { plugin: "mcp", file: file.path },
      });
    };

    if (file.contents.kind === "unreadable") {
      fail([], `The file cannot be read: ${file.contents.message}`);

      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(file.contents.text);
    } catch (error) {
      fail([], `The file is not valid JSON: ${error instanceof Error ? error.message : ""}`);

      continue;
    }

    if (!Value.Check(ConfigFile, parsed)) {
      fail([], 'The file must be an object with an "mcpServers" object.');

      continue;
    }

    for (const [name, raw] of Object.entries(parsed.mcpServers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        fail([name], `Server names may contain only letters, digits, "_" and "-": ${name}.`);

        continue;
      }

      const key = name.replaceAll("-", "_");
      const taken = canonical.get(key);

      if (taken !== undefined && taken !== name) {
        fail([name], `${name} and ${taken} name the same server.`);

        continue;
      }

      if (!Value.Check(Entry, raw)) {
        const [first] = Value.Errors(Entry, raw);
        fail([name], `${name}${first?.instancePath ?? ""} ${first?.message ?? "is invalid"}.`);

        continue;
      }

      const base = servers.get(name);

      if (raw.command === undefined && raw.url === undefined && raw.type === undefined) {
        const extra = Object.keys(raw).filter((field) => !OVERRIDE_KEYS.has(field));

        if (file.scope !== "project" || base === undefined)
          fail([name], `${name} needs "command" or "url".`);
        else if (extra.length > 0)
          fail([name], `An override of ${name} can only set enabled, exposure and toolExposure.`);
        else servers.set(name, { ...base, ...settings(raw, base), override: file.path });

        continue;
      }

      const transport = readTransport(raw);

      if (typeof transport === "string") {
        fail([name], `${name}: ${transport}`);

        continue;
      }

      canonical.set(key, name);
      servers.set(name, {
        name,
        scope: file.scope,
        path: file.path,
        override: null,
        transport,
        timeoutMs: (raw.timeout ?? 60) * 1000,
        description: raw.description ?? null,
        ...settings(raw, null),
      });
    }
  }

  return { servers, issues };
}

function readTransport(raw: Static<typeof Entry>): McpTransportConfig | string {
  if (raw.type === "sse")
    return 'the SSE transport is not supported; use the server\'s streamable HTTP url, often ending in "/mcp".';

  if (raw.command !== undefined && raw.url !== undefined)
    return 'set "command" or "url", not both.';

  if (raw.command !== undefined && raw.type !== undefined && raw.type !== "stdio")
    return `type ${raw.type} needs "url", not "command".`;

  if (raw.command !== undefined)
    return {
      kind: "stdio",
      command: raw.command,
      args: raw.args ?? [],
      env: raw.env ?? {},
      cwd: raw.cwd ?? null,
    };

  if (raw.url === undefined) return `type ${raw.type ?? "stdio"} needs "command" or "url".`;

  if (raw.type === "stdio") return 'type stdio needs "command", not "url".';

  const url = URL.parse(raw.url);

  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:"))
    return `${raw.url} is not an http or https URL.`;

  if (raw.command === undefined && raw.oauth?.callbackUrl !== undefined) {
    const callback = URL.parse(raw.oauth.callbackUrl);

    if (
      callback === null ||
      callback.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname)
    )
      return "oauth.callbackUrl must be an http URL on localhost, 127.0.0.1 or [::1].";
  }

  if (raw.oauth?.authServerMetadataUrl !== undefined) {
    const metadata = URL.parse(raw.oauth.authServerMetadataUrl);

    if (
      metadata === null ||
      (metadata.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(metadata.hostname))
    )
      return "oauth.authServerMetadataUrl must use https, except on localhost.";
  }

  return { kind: "http", url: raw.url, headers: raw.headers ?? {}, oauth: raw.oauth ?? {} };
}

function settings(
  raw: Static<typeof Entry>,
  base: McpServerEntry | null,
): Pick<McpServerEntry, "enabled" | "exposure" | "toolExposure"> {
  return {
    enabled: raw.enabled ?? base?.enabled ?? true,
    exposure: raw.exposure === undefined ? (base?.exposure ?? "code") : EXPOSURE[raw.exposure],
    toolExposure:
      raw.toolExposure === undefined
        ? (base?.toolExposure ?? [])
        : Object.entries(raw.toolExposure).map(([pattern, name]) => [pattern, EXPOSURE[name]]),
  };
}

/**
 * Changes the `mcpServers` of one `mcp.json`, keeping the rest of the file:
 * `change` returns the new servers, or `null` when it has nothing to change.
 * A missing file starts empty; one that is not a JSON object is refused. The
 * file is replaced whole, readable only by the user, as it may hold secrets.
 */
export async function editMcpFile(
  path: string,
  change: (servers: { readonly [name: string]: Json }) => { readonly [name: string]: Json } | null,
): Promise<McpChange & { readonly text?: string }> {
  const contents = await readMcpFile(path);

  if (contents.kind === "unreadable")
    return { kind: "invalid", message: `${path} cannot be read: ${contents.message}` };
  let parsed: unknown = {};

  if (contents.kind === "text") {
    try {
      parsed = JSON.parse(contents.text);
    } catch {
      return { kind: "invalid", message: `${path} is not valid JSON; fix it first.` };
    }
  }

  if (!isJson(parsed) || !isJsonObject(parsed))
    return { kind: "invalid", message: `${path} is not a JSON object.` };
  const servers = parsed.mcpServers ?? {};

  if (!isJsonObject(servers))
    return { kind: "invalid", message: `${path} has an "mcpServers" that is not an object.` };
  const next = change(servers);

  if (next === null) return { kind: "missing" };
  const text = `${JSON.stringify({ ...parsed, mcpServers: next }, null, 2)}\n`;
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);

  return { kind: "updated", text };
}
