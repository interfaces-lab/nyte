import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type { CodemodeResult, CodemodeSandboxOptions, CodemodeTool } from "@earendil-works/pi-codemode";
import { renderToolSample } from "@earendil-works/pi-codemode/declarations";
import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import { dev } from "@nyte-ai/core";
import type { ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { isJson, standard } from "@nyte-ai/schema";
import type { Json, ToolContent, ToolInfo, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin, PluginApi } from "./core.ts";

const DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to the tool's output, or its text, and rejects with an Error on failure.
- Optional first line: \`// @options: {"timeout_ms": 60000}\`
- \`text(value)\`, \`console.log(...)\` and \`return\` add output; \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls in this session.
- \`ALL_TOOLS\`, \`searchTools(query, { limit?, namespace? })\` and \`describeTool(name)\` find tools and their declarations.`;

const parameters = standard(Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) }));

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
export function codemodePlugin(runtime: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">): Plugin {
  return {
    id: "codemode",
    activate(api) {
      api.contribute.tools.add(codemode(api, runtime));
    },
  };
}

/** Returns the `codemode` tool; the script's store lives in the plugin's session storage. */
function codemode(api: PluginApi, runtime: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">): ToolDefinition<{ code: string }> {
  return {
    name: "codemode",
    description: DESCRIPTION,
    parameters,
    grammar: { kind: "lark", source: CODEMODE_SOURCE_GRAMMAR },
    class: () => ({ kind: "custom", label: "Running a script" }),
    replay: "never",
    async execute(args, invocation) {
      const { code, options } = parseCodemodeSource(args.code);
      const callable = invocation.tools.list().filter((info) => info.name !== "codemode" && info.exposure !== "hidden");
      const stored = await api.storage.get<{ readonly [key: string]: Json }>("store");

      const sandbox = new CodemodeSandbox({
        ...runtime,
        tools: callable.map((info) => bridge(info, invocation)),
        globals: discovery(callable),
        timeoutMs: options.timeoutMs ?? 300_000,
        memoryLimitBytes: 256 * 1024 * 1024,
      });

      dev("codemode", "run", { call: invocation.call, tools: callable.length });
      const result = await sandbox.execute(code, { signal: invocation.signal, store: stored ?? {} }).finally(() => sandbox.close());
      dev("codemode", "end", { call: invocation.call, ok: result.ok, calls: result.calls.length });

      if (!result.ok) throw new Error(`${result.error.kind === "script" ? (result.error.stack ?? result.error.message) : `Script ${result.error.kind}: ${result.error.message}`}\n${calls(result)}`);
      const writes = Object.entries(result.storeWrites.set).flatMap(([key, value]) => (isJson(value) ? [[key, value] as const] : []));

      if (writes.length > 0 || result.storeWrites.delete.length > 0) {
        const next: { [key: string]: Json } = { ...stored, ...Object.fromEntries(writes) };

        for (const key of result.storeWrites.delete) delete next[key];
        await api.storage.set("store", next);
      }

      const content: ToolContent[] = [];

      for (const item of result.output) {
        if (item.type === "text") content.push({ kind: "text", text: item.text });
        else content.push({ kind: "file", blob: await invocation.env.files.upload(once(Uint8Array.fromBase64(item.data))), mime: item.mimeType });
      }

      if (result.value !== undefined) content.push({ kind: "text", text: typeof result.value === "string" ? result.value : JSON.stringify(result.value) });

      return { content: content.length === 0 ? [{ kind: "text", text: "The script produced no output." }] : content };
    },
  };
}

/** Returns a sandbox tool that runs one session tool under `before_tool`, each call keyed by its start order so a re-run replays it. */
function bridge(info: ToolInfo, invocation: ToolInvocation): CodemodeTool {
  let sequence = 0;

  return {
    name: info.name,
    description: info.description,
    inputSchema: info.parameters,
    outputSchema: info.output ?? { type: "string" },
    async execute(args, { signal }) {
      const key = `codemode:${info.name}:${sequence++}`;

      return valueOf(await invocation.tools.execute(info.name, isJson(args) ? args : null, { key, signal }));
    },
  };
}

/** Returns what a script receives for a settled call: the output when the tool declares one, else its text; a call that did not succeed throws. */
function valueOf(outcome: ToolOutcome): Json {
  if (outcome.kind === "ok")
    return outcome.output ?? outcome.content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("\n");

  throw new Error(outcome.kind === "failed" ? outcome.message : outcome.kind === "rejected" ? `Rejected: ${outcome.reason}` : `The call was ${outcome.kind}.`);
}

/** Returns the discovery globals over the callable tools: `searchTools(query, { limit, namespace })` ranked by shared words, within one `ToolInfo.namespace` when given (§48d), and `describeTool(name)` a tool's declaration. */
function discovery(tools: readonly ToolInfo[]): CodemodeTool[] {
  return [
    {
      name: "searchTools",
      spread: true,
      execute(args) {
        const [query, options] = Array.isArray(args) ? args : [];
        const words = new Set(String(query).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1));
        const limit = typeof options === "object" && options !== null && "limit" in options && typeof options.limit === "number" ? options.limit : 8;
        const namespace = typeof options === "object" && options !== null && "namespace" in options && typeof options.namespace === "string" ? options.namespace : null;

        return tools
          .filter((info) => namespace === null || info.namespace === namespace)
          .map((info) => ({ info, score: `${info.name} ${info.description}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => words.has(word)).length }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, limit)
          .map(({ info }) => ({ name: info.name, namespace: info.namespace, description: info.description }));
      },
    },
    {
      name: "describeTool",
      execute(name) {
        const info = tools.find((candidate) => candidate.name === name);

        if (info === undefined) throw new Error(`No tool is named ${String(name)}.`);

        return renderToolSample({ name: info.name, description: info.description, inputSchema: info.parameters, outputSchema: info.output ?? { type: "string" } });
      },
    },
  ];
}

/** Returns the calls a failed script made, which are not undone. */
function calls(result: CodemodeResult): string {
  return result.calls.length === 0
    ? "No tool calls were made."
    : `Tool calls made before the failure (not undone): ${result.calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
}

/** Returns one chunk as a stream, for `files.upload`. */
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
