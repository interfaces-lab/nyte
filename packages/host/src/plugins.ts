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
import type { ExecutionEnv, Plugin } from "@nyte-ai/core/plugins";
import { pluginSource, withPluginSource } from "@nyte-ai/core/plugin-source";
import { bashDescriptionPlugin } from "@nyte-ai/plugin/examples/bash-description";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { questionPlugin } from "@nyte-ai/plugin/examples/question";
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
import { createPluginSources } from "./plugins/sources.ts";
import type { PluginSources } from "./plugins/sources.ts";
import { hostModules } from "./plugins/host-modules.ts";
import { nodePluginLoader } from "./plugins/node-loader.ts";
import { discoverPluginUnits } from "./plugins/units.ts";
import type { PluginRoot, PluginUnit } from "./plugins/units.ts";
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
    /** The opened workspace the context files are read through. */
    readonly env: ExecutionEnv;
  },
): Promise<ResolvedPlugins> {
  const [manifests, skills] = await Promise.all([
    readManifests(target),
    loadSkills(skillDirectories(target)),
  ]);
  const { manifest } = manifests;

  const mcp = manifest.mcp ?? {};

  const contextFiles = await loadProjectContextFiles({
    env: context.env,
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
      bashDescriptionPlugin,
      openaiCompactionPlugin({ models: context.models }),
      openaiAstraContextPlugin(),
      fastModePlugin({ models: context.models, defaultModel: context.model }),
      questionPlugin,
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
  return { plugins: prepared.plugins, failures: [...manifests.failures, ...prepared.failures] };
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
  const { manifest, failures } = await readManifests(target);
  const failure = failures[0];

  if (failure !== undefined) throw new Error(`${failure.path}: ${failure.error}`);

  return manifest;
}

/** The merged manifest from every readable file, and each malformed one against its path. */
async function readManifests(
  target: PluginTarget,
): Promise<{ readonly manifest: HostManifest; readonly failures: PluginFailure[] }> {
  const failures: PluginFailure[] = [];
  const files = await Promise.all(
    manifestPaths(target).map((path) =>
      readManifestFile(path).catch((cause: unknown) => {
        failures.push({ path, error: cause instanceof Error ? cause.message : String(cause) });

        return undefined;
      }),
    ),
  );

  const merged: HostManifest = {};

  for (const file of files) {
    if (file?.plugins !== undefined) merged.plugins = [...(merged.plugins ?? []), ...file.plugins];

    if (file?.mcp !== undefined) merged.mcp = { ...merged.mcp, ...file.mcp };
  }

  return { manifest: merged, failures };
}

async function readManifestFile(path: string): Promise<HostManifest | undefined> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });
  if (text === undefined) return undefined;

  const parsed: unknown = JSON.parse(text);

  if (manifestFile.Check(parsed)) return parsed;

  const problems = manifestFile
    .Errors(parsed)
    .map((error) => `${error.instancePath || "/"}: ${error.message}`);

  throw new Error(problems.join("; "));
}

export { createPluginSources } from "./plugins/sources.ts";
export type { Loaded, PluginSources, Prepare, Prepared, Track } from "./plugins/sources.ts";
export { nodePluginLoader } from "./plugins/node-loader.ts";
export { hostModules } from "./plugins/host-modules.ts";
export {
  createSourceWatcher,
  notifyPluginSources,
  watchPluginDirectories,
} from "./plugins/watch.ts";
export type { SourceWatcher, WatchOptions, WatchTarget } from "./plugins/watch.ts";
export { discoverPluginUnits, unitDataFiles } from "./plugins/units.ts";
export type { PluginRoot, PluginUnit, PluginEntries, UnitSource } from "./plugins/units.ts";

/** A plugin source that did not load. `id` names the unit; a manifest or directory failure has none. */
export interface PluginFailure {
  readonly id?: string;
  readonly path: string;
  readonly error: string;
}

/**
 * Everything that loaded, plus a placeholder for each failed unit so the session
 * lists it as `failed` with its error, and every failure against its path.
 */
export interface ResolvedPlugins {
  readonly plugins: Plugin[];
  readonly failures: PluginFailure[];
}

export function samePluginSources(left: readonly Plugin[], right: readonly Plugin[]): boolean {
  return (
    left.length === right.length &&
    left.every((plugin, index) => {
      const other = right[index];
      if (other === undefined || other.id !== plugin.id) return false;
      const source = pluginSource(plugin);
      const otherSource = pluginSource(other);
      if (source === undefined || otherSource === undefined) return plugin === other;
      return (
        otherSource.version === source.version &&
        otherSource.source === source.source &&
        otherSource.path === source.path
      );
    })
  );
}

export interface ResolveOptions {
  readonly builtins: readonly Plugin[];
  readonly directories?: readonly PluginRoot[];
  readonly manifest?: Pick<HostManifest, "plugins">;
  readonly builtinVersion?: string;
  readonly builtinVersions?: Readonly<Record<string, string>>;
  readonly sources: PluginSources<unknown>;
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

export async function resolvePlugins(options: ResolveOptions): Promise<ResolvedPlugins> {
  const byId = new Map<string, Plugin>();
  const failures: PluginFailure[] = [];
  const units = new Map<string, PluginUnit>();
  for (const root of options.directories ?? []) {
    // One unreadable root loses its own units, not another root's.
    const discovered = await discoverPluginUnits([root]).catch((cause: unknown) => {
      failures.push({
        path: root.path,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return [];
    });
    for (const unit of discovered) units.set(unit.id, unit);
  }
  for (const builtin of options.builtins) {
    byId.set(
      builtin.id,
      withPluginSource(builtin, {
        source: "builtin",
        version: options.builtinVersions?.[builtin.id] ?? options.builtinVersion ?? "builtin",
      }),
    );
  }
  const disabled = new Set(
    options.manifest?.plugins?.flatMap((item) => (item.startsWith("-") ? [item.slice(1)] : [])) ??
      [],
  );
  for (const unit of units.values()) {
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
      byId.set(
        unit.id,
        withPluginSource(module, {
          source: unit.source,
          path: entry,
          version: loaded.version,
        }),
      );
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      failures.push({ id: unit.id, path: entry, error });
      // The unit keeps its place in the set so the session lists it as failed;
      // its version follows the error, so a changed outcome is a new revision.
      byId.set(
        unit.id,
        withPluginSource(
          {
            id: unit.id,
            session() {
              throw new Error(error);
            },
          },
          { source: unit.source, path: entry, version: `failed:${digest(error)}` },
        ),
      );
    }
  }
  return { plugins: [...byId.values()].filter((item) => !disabled.has(item.id)), failures };
}

const nodeWatcher = createSourceWatcher(notifyPluginSources);
let defaultSources: PluginSources<unknown> | undefined;

function nodeSources(): PluginSources<unknown> {
  if (defaultSources !== undefined) return defaultSources;
  defaultSources = createPluginSources(nodePluginLoader(hostModules), nodeWatcher.wait);
  return defaultSources;
}
