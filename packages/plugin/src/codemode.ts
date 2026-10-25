import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type {
  CodemodeResult,
  CodemodeSandboxOptions,
  CodemodeTool,
} from "@earendil-works/pi-codemode";
import { renderToolSample, toCodemodeIdentifier } from "@earendil-works/pi-codemode/declarations";
import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import { estimateTextTokens } from "@nyte-ai/ai/utils/estimate";
import { dev } from "@nyte-ai/core";
import type { ToolDefinition, ToolInvocation, ToolNamespace } from "@nyte-ai/core";
import { isJson, isJsonObject, SdkError, standard } from "@nyte-ai/schema";
import type { Json, JsonSchema, ToolContent, ToolInfo, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";
import { createToolSearchDocument, DEFAULT_SEARCH_LIMIT, rankTools } from "./tool-search.ts";

const DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to the tool's output, or its text, and rejects with an Error on failure.
- Optional first line: \`// @options: {"timeout_ms": 60000}\`
- \`text(value)\`, \`console.log(...)\` and \`return\` add output; \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls in this session.
- \`ALL_TOOLS\`, \`await searchTools(query, { limit?, namespace? })\`, \`await describeTool(name)\` and \`await describeNamespace(name)\` find unlisted tools, such as MCP tools, and their declarations.`;

/** Estimated tokens the listed declarations may use, shared by every namespace. */
const LISTING_TOKENS = 3000;

const parameters = standard(
  Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) }),
);

/**
 * Returns the codemode plugin with the sandbox runtime a bundled client
 * passes (its worker entry and wasm); the default export uses the installed
 * package's own. The `codemode` tool runs a script in a QuickJS worker whose
 * only capability is calling the session's tools through
 * `invocation.tools.execute`, including those exposed to code only.
 *
 * @category plugins
 * @since 0.1.0
 */
export function codemodePlugin(
  runtime: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">,
): Plugin {
  return {
    id: "codemode",
    activate(api) {
      api.contribute.tools.add(codemode(api, runtime));
      api.contribute.prompt.add((draft, siblings) => {
        const text = listTools(siblings.tools.list());

        if (text !== null) draft.set("codemode", { id: "codemode", order: 96, text });
      });
    },
  };
}

type ListingGroup = {
  readonly namespace: ToolNamespace | undefined;
  readonly entries: readonly {
    readonly name: string;
    readonly section: string;
    readonly cost: number;
  }[];
};

/**
 * The `code` tools' declarations, grouped by namespace, within
 * {@link LISTING_TOKENS}. `deferred` tools are never listed, so tools that
 * register late, such as MCP servers', leave the prompt alone.
 */
function listTools(definitions: readonly ToolDefinition[]): string | null {
  const sections = definitions.flatMap((definition) => {
    if (definition.exposure !== "code") return [];
    const inputSchema = toJsonSchema(definition.parameters, "input");
    const outputSchema =
      definition.output === undefined
        ? { type: "string" }
        : toJsonSchema(definition.output, "output");

    if (inputSchema === null || outputSchema === null) return [];
    const id = toCodemodeIdentifier(definition.name);
    const sample = renderToolSample({
      name: definition.name,
      description: definition.description,
      inputSchema,
      outputSchema,
    }).trim();
    const section = `### \`${id}\`${id === definition.name ? "" : ` (\`${definition.name}\`)`}\n${sample}`;

    return [
      {
        namespace: definition.namespace,
        name: definition.name,
        section,
        cost: estimateTextTokens(section),
      },
    ];
  });

  if (sections.length === 0) return null;

  const groups: readonly ListingGroup[] = [
    ...Map.groupBy(sections, (entry) => entry.namespace?.name ?? "").entries(),
  ]
    .toSorted((left, right) => left[0].localeCompare(right[0]))
    .map((pair) => ({ namespace: pair[1][0]?.namespace, entries: pair[1] }));

  const shown = selectListed(groups, LISTING_TOKENS);

  return [
    "Tools you reach only from a codemode script, as `await tools.<name>(args)`:",
    ...groups.flatMap((group) => {
      const visible = group.entries.filter((entry) => shown.has(entry.name));

      if (group.namespace === undefined) return visible.map((entry) => entry.section);
      const listing =
        visible.length === group.entries.length
          ? ""
          : visible.length === 0
            ? " (tools not listed)"
            : " (some tools not listed)";
      const description = group.namespace.description?.trim() ?? "";

      return [
        `## ${group.namespace.name}${listing}${description === "" ? "" : `\n${description}`}`,
        ...visible.map((entry) => entry.section),
      ];
    }),
  ].join("\n\n");
}

/**
 * Picks the sections that fit `budget`: each round, every group places its
 * cheapest remaining tool, and a group whose next tool does not fit drops
 * out, so every namespace shows before any is complete.
 */
function selectListed(groups: readonly ListingGroup[], budget: number): ReadonlySet<string> {
  const queues = groups.map((group) => group.entries.toSorted((a, b) => a.cost - b.cost));
  const shown = new Set<string>();
  let remaining = budget;
  let active = queues.filter((queue) => queue.length > 0);

  while (active.length > 0)
    active = active.filter((queue) => {
      const next = queue[0];

      if (next === undefined || next.cost > remaining) return false;
      remaining -= next.cost;
      shown.add(next.name);
      queue.shift();

      return queue.length > 0;
    });

  return shown;
}

function toJsonSchema(
  schema: ToolDefinition["parameters"],
  direction: "input" | "output",
): JsonSchema | null {
  try {
    const converted = schema["~standard"].jsonSchema[direction]({ target: "draft-2020-12" });

    return isJson(converted) && isJsonObject(converted) ? converted : null;
  } catch {
    return null;
  }
}

/** The `codemode` tool; `model-only`, so scripts cannot start other scripts. */
function codemode(
  api: PluginApi,
  runtime: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">,
): ToolDefinition<{ code: string }> {
  return {
    name: "codemode",
    description: DESCRIPTION,
    parameters,
    exposure: "model-only",
    grammar: { kind: "lark", source: CODEMODE_SOURCE_GRAMMAR },
    class: () => ({ kind: "custom", label: "Running a script" }),
    effects: "none",
    approval: "never",
    replay: "never",
    async execute(args, invocation) {
      const { code, options } = parseCodemodeSource(args.code);
      const callable = invocation.tools
        .list()
        .filter((info) => info.exposure !== "model-only" && info.exposure !== "hidden");
      const stored = await api.storage.get("store");

      if (stored !== undefined && !isJsonObject(stored))
        throw new SdkError("internal", "Codemode's stored values are not a JSON object.");

      const namespaces = new Map(
        api.contribute.tools
          .list()
          .flatMap((definition) =>
            definition.namespace === undefined ? [] : [[definition.name, definition.namespace]],
          ),
      );

      const samples = new Map(
        callable.map((info) => [
          info.name,
          renderToolSample({
            name: info.name,
            description: info.description,
            inputSchema: info.parameters,
            outputSchema: info.output ?? { type: "string" },
          }),
        ]),
      );

      const sandbox = new CodemodeSandbox({
        ...runtime,
        tools: callable.map((info) => bridge(info, samples.get(info.name) ?? "", invocation)),
        globals: discovery(callable, samples, namespaces),
        timeoutMs: options.timeoutMs ?? 300_000,
        memoryLimitBytes: 256 * 1024 * 1024,
      });

      dev("codemode", "run", { call: invocation.call, tools: callable.length });
      let result: CodemodeResult;
      try {
        result = await sandbox.execute(code, { signal: invocation.signal, store: stored ?? {} });
      } finally {
        await sandbox.close();
      }
      dev("codemode", "end", { call: invocation.call, ok: result.ok, calls: result.calls.length });

      if (!result.ok)
        throw new Error(
          `${result.error.kind === "script" ? (result.error.stack ?? result.error.message) : `Script ${result.error.kind}: ${result.error.message}`}\n${calls(result)}`,
        );
      const writes = Object.entries(result.storeWrites.set).flatMap(([key, value]) =>
        isJson(value) ? [[key, value] as const] : [],
      );

      if (writes.length > 0 || result.storeWrites.delete.length > 0) {
        const next: { [key: string]: Json } = { ...stored, ...Object.fromEntries(writes) };

        for (const key of result.storeWrites.delete) delete next[key];
        await api.storage.set("store", next);
      }

      const content: ToolContent[] = [];

      for (const item of result.output) {
        if (item.type === "text") content.push({ kind: "text", text: item.text });
        else
          content.push({
            kind: "file",
            blob: await invocation.env.files.upload(once(Uint8Array.fromBase64(item.data))),
            mime: item.mimeType,
          });
      }

      if (result.value !== undefined)
        content.push({
          kind: "text",
          text: typeof result.value === "string" ? result.value : JSON.stringify(result.value),
        });

      return {
        content:
          content.length === 0
            ? [{ kind: "text", text: "The script produced no output." }]
            : content,
      };
    },
  };
}

/** A script's tool, described by its declaration so `ALL_TOOLS` entries carry it. */
function bridge(info: ToolInfo, sample: string, invocation: ToolInvocation): CodemodeTool {
  let sequence = 0;

  return {
    name: info.name,
    description: sample,
    inputSchema: info.parameters,
    outputSchema: info.output ?? { type: "string" },
    async execute(args, { signal }) {
      const key = `codemode:${info.name}:${sequence++}`;

      return unwrapToolOutcome(
        await invocation.tools.execute(info.name, isJson(args) ? args : null, { key, signal }),
      );
    },
  };
}

function unwrapToolOutcome(outcome: ToolOutcome): Json {
  if (outcome.kind === "ok")
    return (
      outcome.output ??
      outcome.content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("\n")
    );

  throw new Error(
    outcome.kind === "failed"
      ? outcome.message
      : outcome.kind === "rejected"
        ? `Rejected: ${outcome.reason}`
        : `The call was ${outcome.kind}.`,
  );
}

/**
 * `searchTools()`, `describeTool()` and `describeNamespace()`: ranked search
 * and lookup over the script's tools and their namespaces, by raw name or
 * script identifier.
 */
function discovery(
  tools: readonly ToolInfo[],
  samples: ReadonlyMap<string, string>,
  namespaces: ReadonlyMap<string, ToolNamespace>,
): CodemodeTool[] {
  return [
    {
      name: "searchTools",
      spread: true,
      execute(args) {
        const [query, options] = Array.isArray(args) ? args : [];

        if (typeof query !== "string") throw new Error("searchTools() expects a query string");
        const limit = isJsonObject(options) ? (options.limit ?? null) : null;
        const namespace = isJsonObject(options) ? (options.namespace ?? null) : null;

        if (limit !== null && (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0))
          throw new Error("searchTools() limit must be a positive integer");

        if (namespace !== null && typeof namespace !== "string")
          throw new Error("searchTools() namespace must be a string");

        const documents = tools.flatMap((info) => {
          const found = namespaces.get(info.name);

          if (namespace !== null && (found === undefined || !matchesNamespace(found, namespace)))
            return [];

          return [createToolSearchDocument(info, found)];
        });

        return rankTools(query, documents, limit ?? DEFAULT_SEARCH_LIMIT).map((name) => ({
          name: toCodemodeIdentifier(name),
          description: samples.get(name) ?? "",
        }));
      },
    },
    {
      name: "describeTool",
      execute(name) {
        if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
        const info = tools.find(
          (candidate) => candidate.name === name || toCodemodeIdentifier(candidate.name) === name,
        );

        if (info === undefined) throw new Error(`No tool is named ${name}.`);

        return samples.get(info.name) ?? "";
      },
    },
    {
      name: "describeNamespace",
      execute(name) {
        if (typeof name !== "string")
          throw new Error("describeNamespace() expects a namespace name");
        const members = tools.filter((info) => {
          const found = namespaces.get(info.name);

          return found !== undefined && matchesNamespace(found, name);
        });
        const namespace = members[0] === undefined ? undefined : namespaces.get(members[0].name);

        if (namespace === undefined) throw new Error(`No namespace is named ${name}.`);

        return {
          name: namespace.name,
          ...(namespace.description === undefined ? {} : { description: namespace.description }),
          ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
          tools: members.map((info) => toCodemodeIdentifier(info.name)),
        };
      },
    },
  ];
}

/** Whether `query` is the namespace's name or an alias, as written or as the same script identifier. */
function matchesNamespace(namespace: ToolNamespace, query: string): boolean {
  const id = toCodemodeIdentifier(query);

  return [namespace.name, ...(namespace.aliases ?? [])].some(
    (name) => name === query || toCodemodeIdentifier(name) === id,
  );
}

function calls(result: CodemodeResult): string {
  return result.calls.length === 0
    ? "No tool calls were made."
    : `Tool calls made before the failure (not undone): ${result.calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
}

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * The codemode plugin over the installed sandbox runtime.
 *
 * @category plugins
 * @since 0.1.0
 */
export default codemodePlugin({}) satisfies Plugin;
