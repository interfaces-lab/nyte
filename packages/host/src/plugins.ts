import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Type, Unsafe } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { FileCredentialStore } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import { loadProjectContextFiles, formatContextFilesForPrompt } from "@nyte-ai/core";
import type { Api, Model } from "@nyte-ai/schema";
import {
  SKILLS_PLUGIN_ID,
  definePlugin,
  loadSkills,
  skillsPlugin,
  systemPromptPlugin,
  toolsFsPlugin,
} from "@nyte-ai/core/plugins";
import type { LoadedPlugin, Plugin } from "@nyte-ai/core/plugins";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import { renamePlugin } from "@nyte-ai/plugin/examples/rename";
import { MCP_PLUGIN_ID, McpServerConfig, McpServers, mcpPlugin } from "@nyte-ai/plugin/mcp";
import { codemodePlugin } from "@nyte-ai/plugin/codemode";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/codemode-runtime";
import { webSearchCredentialId, webSearchPlugins } from "@nyte-ai/plugin/examples/web-search";
import type { WebSearchCredentials } from "@nyte-ai/plugin/examples/web-search";
import {
  isFileError,
  manifestPaths,
  nyteHome,
  pluginDirectories,
  skillDirectories,
} from "./paths.ts";
import type { PluginTarget } from "./paths.ts";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { createPluginSources } from "./plugins/sources.ts";
import type { PluginSources } from "./plugins/sources.ts";
import { nodePluginLoader } from "./plugins/node-loader.ts";
import { discoverPluginUnits } from "./plugins/units.ts";
import type { PluginRoot } from "./plugins/units.ts";
import { createSourceWatcher, notifyPluginSources } from "./plugins/watch.ts";

// MCP connections belong to the process: every session shares them, and a
// session reload that leaves a server's config alone keeps its connection.
const mcpServers = new McpServers();

export async function resolveHostPlugins(
  target: PluginTarget,
  context: {
    readonly models: MutableModels;
    readonly model: Model<Api>;
    readonly extra?: readonly Plugin[];
    readonly sources?: PluginSources<unknown>;
    readonly codemode?: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">;
  },
): Promise<ResolvedPlugins> {
  const [manifest, skills] = await Promise.all([
    readManifest(target).catch((cause: unknown) => {
      throw new PluginPreparationError([
        { path: "manifest", error: cause instanceof Error ? cause.message : String(cause) },
      ]);
    }),
    loadSkills(skillDirectories(target)),
  ]);

  const mcp = manifest.mcp ?? {};
  const contextFiles = loadProjectContextFiles({
    cwd: target.kind === "project" ? target.workspace.cwd : homedir(),
    globalDir: nyteHome(),
    warn: (message) => {
      throw new Error(message);
    },
  });
  const contextText = formatContextFilesForPrompt(contextFiles);

  const prepared = await resolvePlugins({
    builtins: [
      systemPromptPlugin(),
      renamePlugin({ models: context.models, model: context.model }),
      definePlugin({
        id: "context-files",
        session(api) {
          if (contextText !== "")
            api.prompt.add((draft) =>
              draft.set("project-context", { text: contextText, order: 10 }),
            );
        },
      }),
      toolsFsPlugin(),
      openaiCompactionPlugin({ models: context.models }),
      openaiAstraContextPlugin(),
      fastModePlugin({ models: context.models, defaultModel: context.model }),
      ...webSearchPlugins({ credentials: webSearchCredentials() }),
      mcpPlugin({ servers: mcpServers, config: mcp }),
      ...(context.extra ?? []),
      codemodePlugin(context.codemode),
      skillsPlugin(skills),
    ],
    directories: pluginDirectories(target),
    manifest,
    sources: context.sources ?? nodeSources(),
    builtinVersions: {
      // Identity, not a counter: a rescan that finds the same skills leaves the plugin alone.
      "context-files": `builtin:${digest(JSON.stringify(contextFiles))}`,
      [SKILLS_PLUGIN_ID]: `builtin:${digest(JSON.stringify(skills))}`,
      [MCP_PLUGIN_ID]: `builtin:${digest(JSON.stringify(mcp))}`,
    },
  });
  if (prepared.kind === "failed") throw new PluginPreparationError(prepared.failures);
  return prepared;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function webSearchCredentials(): WebSearchCredentials {
  const store = new FileCredentialStore();

  return {
    async read(provider) {
      const credential = await store.read(webSearchCredentialId(provider));

      return credential?.type === "api_key" ? credential.key : undefined;
    },
    async write(provider, key) {
      const id = webSearchCredentialId(provider);

      if (key === undefined) {
        await store.delete(id);

        return;
      }

      await store.modify(id, () => Promise.resolve({ type: "api_key", key }));
    },
  };
}

const manifestSchema = Type.Object(
  {
    plugins: Type.Optional(Type.Array(Type.String())),
    mcp: Type.Optional(Type.Record(Type.String({ minLength: 1 }), McpServerConfig)),
  },
  { additionalProperties: false },
);

const manifestFile = Compile(manifestSchema);

export type HostManifest = Static<typeof manifestSchema>;

/**
 * `nyte.json` under the home directory and under the project's `.nyte`,
 * merged: plugin entries concatenate, project servers replace same-named user
 * servers. A missing file contributes nothing; a malformed one throws.
 */
export async function readManifest(target: PluginTarget): Promise<HostManifest> {
  const files = await Promise.all(manifestPaths(target).map(readManifestFile));

  const merged: HostManifest = {};

  for (const file of files) {
    if (file?.plugins !== undefined) merged.plugins = [...(merged.plugins ?? []), ...file.plugins];

    if (file?.mcp !== undefined) merged.mcp = { ...merged.mcp, ...file.mcp };
  }

  return merged;
}

async function readManifestFile(path: string): Promise<HostManifest | undefined> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });
  if (text === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);

    if (manifestFile.Check(parsed)) return parsed;

    const problems = manifestFile
      .Errors(parsed)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`);

    throw new Error(problems.join("; "));
  } catch (cause) {
    throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

export { createPluginSources } from "./plugins/sources.ts";
export type { Loaded, PluginSources, Prepare, Prepared, Track } from "./plugins/sources.ts";
export { nodePluginLoader } from "./plugins/node-loader.ts";
export {
  createSourceWatcher,
  notifyPluginSources,
  watchPluginDirectories,
} from "./plugins/watch.ts";
export type { SourceWatcher, WatchOptions, WatchTarget } from "./plugins/watch.ts";
export { discoverPluginUnits, unitDataFiles } from "./plugins/units.ts";
export type { PluginRoot, PluginUnit, PluginEntries, UnitSource } from "./plugins/units.ts";
export interface ResolvedPlugins {
  readonly plugins: LoadedPlugin[];
  readonly failures: { readonly path: string; readonly error: string }[];
}

export function samePluginSources(
  left: readonly LoadedPlugin[],
  right: readonly LoadedPlugin[],
): boolean {
  return (
    left.length === right.length &&
    left.every((plugin, index) => {
      const other = right[index];
      return (
        other?.id === plugin.id &&
        other.version === plugin.version &&
        other.source === plugin.source &&
        other.path === plugin.path
      );
    })
  );
}

export type PluginPreparation =
  | ({ readonly kind: "ready"; readonly failures: [] } & ResolvedPlugins)
  | { readonly kind: "failed"; readonly failures: ResolvedPlugins["failures"] };

export interface ResolveOptions {
  readonly builtins: readonly Plugin[];
  readonly directories?: readonly PluginRoot[];
  readonly manifest?: Pick<HostManifest, "plugins">;
  readonly builtinVersion?: string;
  readonly builtinVersions?: Readonly<Record<string, string>>;
  readonly sources: PluginSources<unknown>;
}

export class PluginPreparationError extends Error {
  readonly failures: ResolvedPlugins["failures"];

  constructor(failures: ResolvedPlugins["failures"]) {
    super(failures.map((failure) => `${failure.path}: ${failure.error}`).join("; "));
    this.name = "PluginPreparationError";
    this.failures = failures;
  }
}

const PluginModule = Type.Object({
  default: Type.Object({
    id: Type.String({ minLength: 1 }),
    session: Type.Function(
      [Unsafe<Parameters<Plugin["session"]>[0]>({})],
      Unsafe<ReturnType<Plugin["session"]>>({}),
    ),
  }),
});
const pluginModule = Compile(PluginModule);

export async function resolvePlugins(options: ResolveOptions): Promise<PluginPreparation> {
  const byId = new Map<string, LoadedPlugin>();
  const failures: ResolvedPlugins["failures"] = [];
  try {
    const units = await discoverPluginUnits(options.directories ?? []);
    for (const builtin of options.builtins) {
      byId.set(builtin.id, {
        id: builtin.id,
        source: "builtin",
        module: builtin,
        version: options.builtinVersions?.[builtin.id] ?? options.builtinVersion ?? "builtin",
      });
    }
    const disabled = new Set(
      options.manifest?.plugins?.flatMap((item) => (item.startsWith("-") ? [item.slice(1)] : [])) ??
        [],
    );
    for (const unit of units) {
      if (disabled.has(unit.id)) {
        byId.delete(unit.id);
        continue;
      }
      const entry = unit.entries.session;
      if (entry === undefined) {
        byId.delete(unit.id);
        continue;
      }
      try {
        const loaded = await options.sources.read(entry);
        if (!pluginModule.Check(loaded.value))
          throw new Error("default export is not a session plugin (use definePlugin)");
        const module = loaded.value.default;
        if (module.id !== unit.id)
          throw new Error(`plugin id "${module.id}" must match directory name "${unit.id}"`);
        byId.set(unit.id, {
          id: unit.id,
          source: unit.source,
          path: entry,
          version: loaded.version,
          module,
        });
      } catch (cause) {
        failures.push({
          path: entry,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    if (failures.length > 0) return { kind: "failed", failures };
    return {
      kind: "ready",
      plugins: [...byId.values()].filter((item) => !disabled.has(item.id)),
      failures: [],
    };
  } catch (cause) {
    return {
      kind: "failed",
      failures: [
        { path: "plugins", error: cause instanceof Error ? cause.message : String(cause) },
      ],
    };
  }
}

const nodeWatcher = createSourceWatcher(notifyPluginSources);
let defaultSources: PluginSources<unknown> | undefined;

function nodeSources(): PluginSources<unknown> {
  if (defaultSources !== undefined) return defaultSources;
  const load = createRequire(import.meta.url);
  const module: unknown = load("@nyte-ai/plugin");
  if (typeof module !== "object" || module === null) throw new Error("Invalid host plugin module");
  defaultSources = createPluginSources(
    nodePluginLoader({ "@nyte-ai/plugin": module, "@nyte-ai/core/plugins": module }),
    nodeWatcher.wait,
  );
  return defaultSources;
}
