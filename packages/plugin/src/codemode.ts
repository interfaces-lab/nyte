import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type {
  CodemodeResult,
  CodemodeSandboxOptions,
  CodemodeTool,
} from "@earendil-works/pi-codemode";
import { renderToolSample } from "@earendil-works/pi-codemode/declarations";
import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import { dev } from "@nyte-ai/core";
import type { ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { isJson, isJsonObject, SdkError, standard } from "@nyte-ai/schema";
import type { Json, ToolContent, ToolInfo, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin, PluginApi } from "@nyte-ai/plugin/core";

const DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to the tool's output, or its text, and rejects with an Error on failure.
- Optional first line: \`// @options: {"timeout_ms": 60000}\`
- \`text(value)\`, \`console.log(...)\` and \`return\` add output; \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls in this session.
- \`ALL_TOOLS\`, \`searchTools(query, { limit?, namespace? })\` and \`describeTool(name)\` find tools and their declarations.`;

const SUMMARY_CHARS = 160;

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
        const reachable = siblings.tools
          .list()
          .flatMap((tool) =>
            tool.exposure === "code" || tool.exposure === "deferred"
              ? [`- ${tool.name}: ${summarize(tool.description)}`]
              : [],
          )
          .toSorted();

        if (reachable.length === 0) return;

        draft.set("codemode", {
          id: "codemode",
          order: 96,
          text: [
            "Tools you reach only from a codemode script, as `await tools.<name>(args)`; `describeTool(name)` inside a script returns a tool's arguments:",
            ...reachable,
          ].join("\n"),
        });
      });
    },
  };
}

function summarize(description: string): string {
  const [line = ""] = description.trim().split("\n");

  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS)}…` : line;
}

function codemode(
  api: PluginApi,
  runtime: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">,
): ToolDefinition<{ code: string }> {
  return {
    name: "codemode",
    description: DESCRIPTION,
    parameters,
    grammar: { kind: "lark", source: CODEMODE_SOURCE_GRAMMAR },
    class: () => ({ kind: "custom", label: "Running a script" }),
    effects: "none",
    approval: "never",
    replay: "never",
    async execute(args, invocation) {
      const { code, options } = parseCodemodeSource(args.code);
      const callable = invocation.tools
        .list()
        .filter((info) => info.name !== "codemode" && info.exposure !== "hidden");
      const stored = await api.storage.get("store");

      if (stored !== undefined && !isJsonObject(stored))
        throw new SdkError("internal", "Codemode's stored values are not a JSON object.");

      const sandbox = new CodemodeSandbox({
        ...runtime,
        tools: callable.map((info) => bridge(info, invocation)),
        globals: discovery(callable),
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

function bridge(info: ToolInfo, invocation: ToolInvocation): CodemodeTool {
  let sequence = 0;

  return {
    name: info.name,
    description: info.description,
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

function discovery(tools: readonly ToolInfo[]): CodemodeTool[] {
  return [
    {
      name: "searchTools",
      spread: true,
      execute(args) {
        const [query, options] = Array.isArray(args) ? args : [];
        const words = new Set(
          String(query)
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((word) => word.length > 1),
        );
        const limit =
          typeof options === "object" &&
          options !== null &&
          "limit" in options &&
          typeof options.limit === "number"
            ? options.limit
            : 8;
        const namespace =
          typeof options === "object" &&
          options !== null &&
          "namespace" in options &&
          typeof options.namespace === "string"
            ? options.namespace
            : null;

        return tools
          .filter((info) => namespace === null || info.namespace === namespace)
          .map((info) => ({
            info,
            score: `${info.name} ${info.description}`
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((word) => words.has(word)).length,
          }))
          .filter((entry) => entry.score > 0)
          .toSorted((left, right) => right.score - left.score)
          .slice(0, limit)
          .map(({ info }) => ({
            name: info.name,
            namespace: info.namespace,
            description: info.description,
          }));
      },
    },
    {
      name: "describeTool",
      execute(name) {
        const info = tools.find((candidate) => candidate.name === name);

        if (info === undefined) throw new Error(`No tool is named ${String(name)}.`);

        return renderToolSample({
          name: info.name,
          description: info.description,
          inputSchema: info.parameters,
          outputSchema: info.output ?? { type: "string" },
        });
      },
    },
  ];
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
