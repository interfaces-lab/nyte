/**
 * The plugin set a workspace runs: the host's built-ins, then `~/.nyte/plugins`,
 * then `<cwd>/.nyte/plugins`, filtered and configured by `.nyte/nyte.json`.
 * Trust is the argument: a `TrustedWorkspace` exists only after the trust gate,
 * so project code cannot load before the grant.
 */
import { readFile, readdir, lstat, realpath, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { plugin, resolveSync, Transpiler } from "bun";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  ASCIIFontRenderable,
  BoxRenderable,
  CliRenderEvents,
  CodeRenderable,
  DiffRenderable,
  FrameBufferRenderable,
  ImageRenderable,
  InputRenderable,
  LineNumberRenderable,
  MarkdownRenderable,
  Renderable,
  RGBA,
  ScrollBoxRenderable,
  SelectRenderable,
  StyledText,
  SyntaxStyle,
  TabSelectRenderable,
  TextareaRenderable,
  TextRenderable,
  TextTableRenderable,
  bg,
  bold,
  createTextAttributes,
  dim,
  fg,
  h,
  italic,
  link,
  parseColor,
  strikethrough,
  t,
  underline,
} from "@opentui/core";
import type { CliRendererErrorEvent } from "@opentui/core";
import type { Cleanup, Context, Definition, Slot } from "@nyte-ai/plugin";
import type { Nyte, SessionEvent, SessionId } from "@nyte-ai/core";
import { notice } from "./shell.ts";
import type { Shell } from "./shell.ts";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { FileCredentialStore } from "@nyte-ai/ai";
import type { Api, Model, Models } from "@nyte-ai/ai";
import { resolvePlugins } from "@nyte-ai/core";
import type {
  PluginDirectory,
  PluginManifest,
  ResolvedPlugins,
  TrustedWorkspace,
} from "@nyte-ai/core";
import {
  SKILLS_PLUGIN_ID,
  contextFilesPlugin,
  skillsPlugin,
  stockAgentsPlugin,
  systemPromptPlugin,
  toolsFsPlugin,
} from "@nyte-ai/core/plugins";
import { toJsonValue } from "@nyte-ai/core/store";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { notificationsPlugin } from "@nyte-ai/plugin/examples/notifications";
import { questionPlugin } from "@nyte-ai/plugin/examples/question";
import { renamePlugin } from "@nyte-ai/plugin/examples/rename";
import { warmingPlugin } from "@nyte-ai/plugin/examples/warming";
import {
  webSearchCredentialId,
  webSearchPlugins,
  type WebSearchCredentials,
} from "@nyte-ai/plugin/examples/web-search";
import type { JsonValue } from "@nyte-ai/schema";
import { isJsonArray, isJsonObject, isJsonString, isMissingFile } from "./json.ts";

const ModuleNamespace = Type.Object({ default: Type.Optional(Type.Unknown()) });
const PluginDefinition = Type.Object({
  id: Type.String({ minLength: 1 }),
  setup: Type.Function([Type.Unknown()], Type.Unknown()),
});
const PluginCleanup = Type.Function([], Type.Unknown());

let skillsGeneration = 0;

type ManifestPlugin = NonNullable<PluginManifest["plugins"]>[number];

function parseManifestPlugin(value: JsonValue, index: number): ManifestPlugin {
  if (isJsonString(value)) return value;
  const path = `.nyte/nyte.json.plugins[${String(index)}]`;
  if (!isJsonObject(value)) throw new Error(`${path} must be a string or object`);
  const unknown = Object.keys(value).find((key) => key !== "id" && key !== "options");
  if (unknown !== undefined) throw new Error(`${path} has unknown property "${unknown}"`);
  const id = value["id"];
  if (!isJsonString(id)) throw new Error(`${path}.id must be a string`);
  const options = value["options"];
  return options === undefined ? { id } : { id, options };
}

/** Parse the complete `.nyte/nyte.json` before it enters the plugin host. */
export function parsePluginManifest(value: JsonValue): PluginManifest {
  if (!isJsonObject(value)) throw new Error(".nyte/nyte.json must be an object");
  const unknown = Object.keys(value).find((key) => key !== "plugins");
  if (unknown !== undefined) throw new Error(`.nyte/nyte.json has unknown property "${unknown}"`);
  const plugins = value["plugins"];
  if (plugins === undefined) return {};
  if (!isJsonArray(plugins)) throw new Error(".nyte/nyte.json.plugins must be an array");
  return { plugins: plugins.map(parseManifestPlugin) };
}

/** `.nyte/nyte.json` in the project; optional. Disables ids and sets options, never lists plugins. */
async function readManifest(cwd: string): Promise<PluginManifest | undefined> {
  let text: string;
  try {
    text = await readFile(join(cwd, ".nyte", "nyte.json"), "utf8");
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw cause;
  }
  return parsePluginManifest(toJsonValue(JSON.parse(text)));
}

/** Web-search API keys live beside provider credentials, under their own ids. */
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

export interface PluginContext {
  readonly model: Model<Api>;
  readonly models: Models;
}

/** Host plugins the TUI preinstalls before user and project overrides. */
function builtinPlugins(cwd: string, context: PluginContext) {
  return [
    systemPromptPlugin(),
    renamePlugin({ models: context.models, model: context.model }),
    contextFilesPlugin({ globalDir: join(homedir(), ".nyte") }),
    toolsFsPlugin(),
    openaiCompactionPlugin({ models: context.models }),
    fastModePlugin({ models: context.models, defaultModel: context.model }),
    warmingPlugin({ models: context.models }),
    // The tool first, then the provider plugins that join it.
    ...webSearchPlugins({ credentials: webSearchCredentials() }),
    // Attention comes from the event stream, not the shell.
    notificationsPlugin,
    // The question tool parks the run; the shell answers it through `runs.reply`.
    questionPlugin,
    skillsPlugin({ directories: skillDirectories(cwd) }),
    // The SDK turns these delegates into its host-wired `task` tool.
    stockAgentsPlugin(),
  ];
}

/** Built-ins, then `~/.nyte/plugins`, then `<cwd>/.nyte/plugins`. */
export async function resolveWorkspacePlugins(
  workspace: TrustedWorkspace,
  context: PluginContext,
): Promise<ResolvedPlugins> {
  const { cwd } = workspace;
  return resolvePlugins({
    builtins: builtinPlugins(cwd, context),
    directories: pluginDirectories(cwd),
    manifest: await readManifest(cwd),
    builtinVersions: { [SKILLS_PLUGIN_ID]: `builtin:${String(++skillsGeneration)}` },
  });
}

export function pluginDirectories(cwd: string): PluginDirectory[] {
  return [
    { path: join(homedir(), ".nyte", "plugins"), source: "user" },
    { path: join(cwd, ".nyte", "plugins"), source: "project" },
  ];
}

/** Project skills override user skills; Nyte-native locations win over compatibility locations. */
export function skillDirectories(cwd: string): string[] {
  return [
    join(cwd, ".nyte", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".claude", "skills"),
    join(homedir(), ".nyte", "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
}

// Local plugins use the host's API and renderable classes, including in a compiled executable.
plugin({
  name: "nyte-tui-runtime",
  setup(builder) {
    const modules = new Map<string, unknown>([
      ["@nyte-ai/plugin", require("@nyte-ai/plugin")],
      [
        "@opentui/core",
        {
          ASCIIFontRenderable,
          BoxRenderable,
          CliRenderEvents,
          CodeRenderable,
          DiffRenderable,
          FrameBufferRenderable,
          ImageRenderable,
          InputRenderable,
          LineNumberRenderable,
          MarkdownRenderable,
          Renderable,
          RGBA,
          ScrollBoxRenderable,
          SelectRenderable,
          StyledText,
          SyntaxStyle,
          TabSelectRenderable,
          TextareaRenderable,
          TextRenderable,
          TextTableRenderable,
          bg,
          bold,
          createTextAttributes,
          dim,
          fg,
          h,
          italic,
          link,
          parseColor,
          strikethrough,
          t,
          underline,
        },
      ],
    ]);
    for (const [specifier, exported] of modules) {
      if (!Value.Check(ModuleNamespace, exported))
        throw new TypeError(`Invalid runtime module: ${specifier}`);
      builder.module(specifier, () => ({ loader: "object", exports: { ...exported } }));
    }
  },
});

function localSource(spec: string, directory: string) {
  if (spec.startsWith("file://")) return new URL(spec);
  if (spec.startsWith("./") || spec.startsWith("../") || isAbsolute(spec))
    return pathToFileURL(resolve(directory, spec));
  return undefined;
}

/** Based on https://github.com/anomalyco/opencode/blob/c72b535deeacc2496ea610f1bea1a7661b3c2d93/packages/tui/src/plugin/watch.ts */

// Watch plugin sources for changes. Files are watched through their parent
// directory (editors that save by rename replace the inode, which silently
// kills a direct file watch) and filtered by basename so bursts in busy
// directories stay quiet. Symlinked files are additionally watched at their
// resolved target, since edits there emit nothing at the link's location.
// Directory targets are watched at their root only; the plugin source loader
// adds each resolved local dependency separately, including nested helpers.
// Watches are never torn down individually (a stale watch costs one fs handle and a
// spurious onChange); all die with dispose(). Missing retryable targets are
// polled until they can be armed without relying on a racy chain of ancestor
// watches.
export function createSourceWatcher(onChange: () => void) {
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const watched = new Map<string, Set<string> | null>();
  const missing = new Set<string>();
  const arming = new Map<string, Promise<void>>();
  let disposed = false;
  const notify = () => {
    if (!disposed) onChange();
  };
  const forget = (dir: string) => {
    watchers.get(dir)?.close();
    watchers.delete(dir);
    watched.delete(dir);
  };
  const arm = (target: string, retry: boolean) => {
    const active = arming.get(target);
    if (active) return active;
    const result = stat(target)
      .then((info) => {
        if (disposed) return;
        const appeared = missing.delete(target);
        const dir = info.isDirectory() ? target : dirname(target);
        // Directories accept every filename (null); files accept their basename.
        const name = info.isDirectory() ? null : basename(target);
        const existing = watched.get(dir);
        if (existing !== undefined) {
          if (name === null) watched.set(dir, null);
          else existing?.add(name);
          if (appeared) notify();
          return;
        }
        const watcher = watch(dir, (_event, filename) => {
          // A replaced directory keeps this watcher on the dead inode (Linux
          // emits rename, not error); forget it so a later add() re-arms on
          // the recreated path, and still schedule so reconcile runs now.
          if (!existsSync(dir)) {
            forget(dir);
            notify();
            return;
          }
          // A null filename (platform-dependent) always schedules.
          const accept = watched.get(dir);
          if (filename && accept && !accept.has(filename.toString())) return;
          notify();
        });
        watched.set(dir, name === null ? null : new Set([name]));
        // Reconcile after watcher errors so every source is re-added and any
        // temporarily unavailable target moves into the polling set.
        watcher.on("error", () => {
          forget(dir);
          notify();
        });
        watchers.set(dir, watcher);
        if (appeared) notify();
      })
      .catch((cause: unknown) => {
        if (!disposed && retry && isMissing(cause)) missing.add(target);
      })
      .finally(() => arming.delete(target));
    arming.set(target, result);
    return result;
  };
  const add = async (target: string, retry: boolean) => {
    await arm(target, retry);
    // A symlinked source receives edits at its resolved target.
    await lstat(target)
      .then((info) => {
        if (!info.isSymbolicLink()) return undefined;
        return realpath(target).then((resolved) => arm(resolved, retry));
      })
      .catch(() => undefined);
  };
  const dispose = () => {
    disposed = true;
    clearInterval(poll);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    watched.clear();
    missing.clear();
  };
  const poll = setInterval(
    () =>
      missing.forEach((target) => {
        void arm(target, true);
      }),
    500,
  );
  poll.unref();
  return {
    add: (target: string) => add(target, false),
    wait: (target: string) => add(target, true),
    dispose,
  };
}

function isMissing(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
}

/** Based on https://github.com/anomalyco/opencode/blob/c72b535deeacc2496ea610f1bea1a7661b3c2d93/packages/tui/src/plugin/source.bun.ts */

export async function prepareSource(
  entrypoint: string,
  track: (file: string, directory?: boolean) => void,
) {
  const files = new Set<string>();
  const visit = (file: string, search = "") => {
    if (file.split(sep).includes("node_modules")) return;
    if (search) delete require.cache[file + search];
    if (files.has(file)) return;
    files.add(file);
    // Bun exposes ESM here too. Delete known keys even when absent: rejected
    // evaluations are not enumerable, but deletion still invalidates them.
    delete require.cache[file];
    track(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;
    // Scan dependencies only; the normal runtime loader still owns compilation,
    // package resolution, import attributes, and error reporting.
    const imports = (() => {
      try {
        return new Transpiler({
          loader: file.endsWith("tsx")
            ? "tsx"
            : file.endsWith("jsx")
              ? "jsx"
              : /\.[cm]?ts$/.test(file)
                ? "ts"
                : "js",
          target: "bun",
        }).scan(readFileSync(file, "utf8")).imports;
      } catch {
        return [];
      }
    })();
    for (const item of imports) {
      const local =
        item.path.startsWith("./") || item.path.startsWith("../")
          ? new URL(item.path, pathToFileURL(file))
          : localSource(item.path, dirname(file));
      if (!local) continue;
      const requested = fileURLToPath(local);
      // Resolving a workspace symlink can erase its node_modules boundary.
      if (requested.split(sep).includes("node_modules")) continue;
      try {
        visit(
          item.kind === "require-call"
            ? createRequire(file).resolve(requested)
            : resolveSync(requested, dirname(file)),
          local.search,
        );
      } catch {
        // A missing local dependency may appear on the next save. Leave its
        // actual failure (or optional fallback) to the native loader.
        track(dirname(requested), true);
      }
    }
  };
  visit(fileURLToPath(entrypoint));
  return {
    version: randomUUID(),
    load: async (): Promise<Definition> => {
      const exported: unknown = require(fileURLToPath(entrypoint));
      if (!Value.Check(ModuleNamespace, exported))
        throw new TypeError("TUI plugin module must export an object");
      const definition = "default" in exported ? exported.default : exported;
      if (!Value.Check(PluginDefinition, definition))
        throw new TypeError("TUI plugin must have a non-empty id and a setup function");
      return {
        id: definition.id,
        async setup(context) {
          const cleanup = await definition.setup(context);
          if (cleanup === undefined) return undefined;
          if (!Value.Check(PluginCleanup, cleanup))
            throw new TypeError("Expected cleanup function or undefined");
          return async () => {
            await cleanup();
          };
        },
      };
    },
  };
}

/** Based on https://github.com/anomalyco/opencode/blob/c72b535deeacc2496ea610f1bea1a7661b3c2d93/packages/tui/src/plugin/source.ts */

// Keep source fingerprints and import attempts together. Filesystem events
// should reload changed local graphs, not repeat unchanged evaluations.
export function createPluginSources(watchSource: (file: string) => Promise<void>) {
  const sources = new Map<string, Source>();
  const watching = new Set<Promise<void>>();
  return {
    read: async (entrypoint: string) => {
      await Promise.all(watching);
      const previous = sources.get(entrypoint);
      if (
        previous &&
        [...previous.files].every(([file, item]) => item.digest === digest(file, item.directory))
      )
        return previous.loaded;

      const files: Source["files"] = new Map();
      const track = (file: string, directory = false) => {
        if (files.has(file)) return;
        files.set(file, { digest: digest(file, directory), directory });
        const pending = watchSource(file).finally(() => watching.delete(pending));
        watching.add(pending);
      };
      track(fileURLToPath(entrypoint));
      const prepared = await prepareSource(entrypoint, track);
      // Cache the attempt before evaluating it: unchanged failing modules must
      // not repeat import-time effects on every filesystem notification.
      const loaded = prepared.load().then((module) => ({ version: prepared.version, module }));
      sources.set(entrypoint, { loaded, files });
      try {
        return await loaded;
      } finally {
        await Promise.all(watching);
      }
    },
    dispose: () => {
      sources.clear();
    },
  };
}

type Source = {
  loaded: Promise<{ version: string; module: Definition }>;
  files: Map<string, { digest: string; directory: boolean }>;
};

function digest(file: string, directory: boolean) {
  try {
    return createHash("sha256")
      .update(directory ? JSON.stringify(readdirSync(file).toSorted()) : readFileSync(file))
      .digest("hex");
  } catch {
    return "missing";
  }
}

interface Registration {
  readonly target: string;
  readonly version: string;
  readonly plugin: Definition;
  readonly container: BoxRenderable;
  readonly cleanups: Cleanup[];
  readonly slots: Map<string, { readonly render: Slot; readonly container: BoxRenderable }>;
  active: boolean;
}

export async function discoverTuiPlugins(cwd: string): Promise<string[]> {
  const directories = pluginDirectories(cwd).map((directory) => join(directory.path, "tui"));
  const entries = await Promise.all(
    directories.map(async (directory) => {
      const files = await readdir(directory, { withFileTypes: true }).catch((cause: unknown) => {
        if (isMissing(cause)) return [];
        throw cause;
      });
      return (
        await Promise.all(
          files
            .filter((file) => !file.name.startsWith(".") && !file.name.startsWith("_"))
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map(async (file) => {
              const path = join(directory, file.name);
              const info = await stat(path);
              if (info.isFile() && /\.[cm]?[jt]sx?$/.test(file.name))
                return [pathToFileURL(path).href];
              if (!info.isDirectory()) return [];
              for (const name of ["index.ts", "index.tsx", "index.js", "index.mjs", "index.mts"]) {
                const entry = join(path, name);
                if ((await stat(entry).catch(() => undefined))?.isFile())
                  return [pathToFileURL(entry).href];
              }
              return [];
            }),
        )
      ).flat();
    }),
  );
  return entries.flat();
}

/** OpenCode #39776's resolve/compare/swap lifecycle over Nyte's native renderables. */
export class PluginProvider {
  readonly container: BoxRenderable;
  private readonly shell: Shell;
  private readonly workspace: TrustedWorkspace;
  private readonly client: Nyte;
  private readonly sessionID: () => SessionId | undefined;
  private readonly watcher: ReturnType<typeof createSourceWatcher>;
  private readonly sources: ReturnType<typeof createPluginSources>;
  private readonly registrations = new Map<string, Registration>();
  private readonly memories = new Map<string, Map<string, { value: JsonValue }>>();
  private readonly listeners = new Map<Registration, Set<(event: SessionEvent) => void>>();
  private readonly failures = new Map<string, string>();
  private readonly attempts = new Map<string, string>();
  private loading = Promise.resolve();
  private pending: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(input: {
    readonly shell: Shell;
    readonly workspace: TrustedWorkspace;
    readonly client: Nyte;
    readonly sessionID: () => SessionId | undefined;
  }) {
    this.shell = input.shell;
    this.workspace = input.workspace;
    this.client = input.client;
    this.sessionID = input.sessionID;
    this.container = new BoxRenderable(input.shell.renderer, {
      id: "tui-plugins",
      width: "100%",
      flexShrink: 0,
      flexDirection: "column",
    });
    input.shell.live.insertBefore(this.container, input.shell.pendingGutter.container);
    this.watcher = createSourceWatcher(() => {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => {
        void this.reconcile().catch((cause: unknown) => this.report("plugins", cause));
      }, 100);
    });
    this.sources = createPluginSources(this.watcher.add);
    input.shell.renderer.on(CliRenderEvents.RENDER_ERROR, this.onRenderError);
  }

  registered(): readonly { readonly id: string; readonly target: string }[] {
    return [...this.registrations.values()].map((item) => ({
      id: item.plugin.id,
      target: item.target,
    }));
  }

  reconcile(): Promise<void> {
    const result = this.loading.then(async () => {
      if (this.disposed) return;
      await Promise.all(
        pluginDirectories(this.workspace.cwd).map((directory) =>
          this.watcher.wait(join(directory.path, "tui")),
        ),
      );
      const entries = await discoverTuiPlugins(this.workspace.cwd);
      const disabled = new Set(
        (await readManifest(this.workspace.cwd))?.plugins?.flatMap((entry) =>
          isJsonString(entry) && entry.startsWith("-") ? [entry.slice(1)] : [],
        ) ?? [],
      );
      const desired = new Map<
        string,
        { readonly target: string; readonly version: string; readonly plugin: Definition }
      >();
      for (const target of entries) {
        try {
          const loaded = await this.sources.read(target);
          const definition = loaded.module;
          if (!disabled.has(definition.id))
            desired.set(definition.id, { target, version: loaded.version, plugin: definition });
        } catch (cause) {
          const previous = [...this.registrations.values()].find((item) => item.target === target);
          if (previous !== undefined && !disabled.has(previous.plugin.id))
            desired.set(previous.plugin.id, previous);
          this.report(target, cause);
        }
      }
      if (this.disposed) return;
      for (const [id, previous] of this.registrations) {
        if (desired.has(id)) continue;
        await this.deactivate(previous);
        this.registrations.delete(id);
        this.attempts.delete(previous.target);
      }
      for (const [id, desiredPlugin] of desired) {
        const previous = this.registrations.get(id);
        if (previous?.version === desiredPlugin.version && previous.target === desiredPlugin.target)
          continue;
        if (this.attempts.get(desiredPlugin.target) === desiredPlugin.version) continue;
        this.attempts.set(desiredPlugin.target, desiredPlugin.version);
        const item: Registration = {
          ...desiredPlugin,
          container: new BoxRenderable(this.shell.renderer, {
            id: `tui-plugin:${id}`,
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          }),
          cleanups: [],
          slots: new Map(),
          active: false,
        };
        try {
          const cleanup = await item.plugin.setup(this.createPluginContext(item));
          if (cleanup !== undefined) item.cleanups.push(cleanup);
          if (this.disposed) {
            await this.deactivate(item);
            return;
          }
          if (previous !== undefined) {
            this.container.insertBefore(item.container, previous.container);
            await this.deactivate(previous);
          } else this.container.add(item.container);
          item.active = true;
          this.registrations.set(id, item);
          this.failures.delete(item.target);
        } catch (cause) {
          await this.deactivate(item);
          this.report(item.target, cause);
        }
      }
    });
    this.loading = result.catch(() => undefined);
    return result;
  }

  refresh(): void {
    for (const item of this.registrations.values()) {
      try {
        for (const slot of item.slots.values()) {
          for (const child of slot.container.getChildren()) child.destroyRecursively();
          this.PluginSlot(slot.container, slot.render);
        }
      } catch (cause) {
        this.report(item.target, cause);
      }
    }
  }

  emit(event: SessionEvent): void {
    for (const [item, listeners] of this.listeners) {
      if (!item.active) continue;
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (cause) {
          this.report(item.target, cause);
        }
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    clearTimeout(this.pending);
    this.watcher.dispose();
    await this.loading;
    for (const item of this.registrations.values()) await this.deactivate(item);
    this.registrations.clear();
    this.sources.dispose();
    this.memories.clear();
    this.shell.renderer.off(CliRenderEvents.RENDER_ERROR, this.onRenderError);
    this.container.destroyRecursively();
  }

  private createPluginContext(item: Registration): Context {
    const { shell } = this;
    const memory = this.memories.get(item.plugin.id) ?? new Map<string, { value: JsonValue }>();
    this.memories.set(item.plugin.id, memory);
    return {
      renderer: this.shell.renderer,
      get theme() {
        return { fg: shell.theme.foreground, bg: shell.theme.background };
      },
      client: this.client,
      data: {
        listen: (handler) => {
          const listeners = this.listeners.get(item) ?? new Set<(event: SessionEvent) => void>();
          this.listeners.set(item, listeners);
          listeners.add(handler);
          const cleanup = () => {
            listeners.delete(handler);
          };
          item.cleanups.push(cleanup);
          return cleanup;
        },
      },
      storage: {
        memory: (key, options) => {
          const state = memory.get(key) ?? { value: options.initial };
          memory.set(key, state);
          return [
            () => state.value,
            (value) => {
              state.value = value;
            },
          ];
        },
      },
      ui: {
        toast: { show: (options) => notice(this.shell, options.message) },
        slot: (name, render) => {
          if (item.slots.has(name)) throw new Error(`Slot already registered: ${name}`);
          const container = new BoxRenderable(this.shell.renderer, {
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          });
          const slot = { render, container };
          item.slots.set(name, slot);
          item.container.add(container);
          this.PluginSlot(container, render);
          const cleanup = () => {
            if (item.slots.get(name) === slot) item.slots.delete(name);
            container.destroyRecursively();
          };
          item.cleanups.push(cleanup);
          return cleanup;
        },
      },
    };
  }

  private PluginSlot(container: BoxRenderable, render: Slot): void {
    const sessionID = this.sessionID();
    if (sessionID === undefined) return;
    container.add(render({ sessionID }));
  }

  private async deactivate(item: Registration): Promise<void> {
    item.active = false;
    this.listeners.delete(item);
    for (const cleanup of item.cleanups.splice(0).toReversed()) {
      try {
        await cleanup();
      } catch (cause) {
        this.report(item.target, cause);
      }
    }
    try {
      item.container.destroyRecursively();
    } catch (cause) {
      this.report(item.target, cause);
    }
  }

  private report(target: string, cause: unknown): void {
    if (this.disposed) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (this.failures.get(target) === message) return;
    this.failures.set(target, message);
    notice(this.shell, `Plugin ${basename(target)}: ${message}`, this.shell.theme.error);
  }

  private readonly onRenderError = (event: CliRendererErrorEvent): void => {
    const owner = (node: Renderable | null | undefined): Registration | undefined => {
      if (node === null || node === undefined) return undefined;
      return (
        [...this.registrations.values()].find((item) => item.container === node) ??
        owner(node.parent)
      );
    };
    const item = owner(event.renderable);
    if (item === undefined) throw event.error;
    item.container.visible = false;
    this.report(item.target, event.error);
  };
}
