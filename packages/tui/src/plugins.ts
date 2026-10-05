import { Type } from "typebox";
import { Value } from "typebox/value";
import { BoxRenderable, CliRenderEvents } from "@opentui/core";
import { ensureRuntimePluginSupport } from "@opentui/core/runtime-plugin-support/configure";
import type { CliRendererErrorEvent, Renderable } from "@opentui/core";
import type { Cleanup, Context, Definition, Slot } from "@nyte-ai/plugin";
import type { Nyte, SessionEvent, SessionId } from "@nyte-ai/core";
import { notice } from "./app/ui.ts";
import type { Shell } from "./app/ui.ts";
import { basename } from "node:path";
import { pluginDirectories, manifestPaths, readManifest } from "@nyte-ai/host";
import {
  createPluginSources,
  createSourceWatcher,
  discoverPluginUnits,
  hostModules,
} from "@nyte-ai/host/plugins";
import type { PluginSources } from "@nyte-ai/host/plugins";
import { bunPluginLoader } from "./plugin-loader.ts";
import type { TrustedWorkspace } from "@nyte-ai/host";
import type { JsonValue } from "@nyte-ai/schema";

const ModuleNamespace = Type.Object({ default: Type.Optional(Type.Unknown()) });

const PluginDefinition = Type.Object({
  id: Type.String({ minLength: 1 }),
  setup: Type.Function([Type.Unknown()], Type.Unknown()),
});

const PluginCleanup = Type.Function([], Type.Unknown());

ensureRuntimePluginSupport();

const prepareSource = bunPluginLoader(hostModules);

interface Registration {
  readonly target: string;
  readonly version: string;
  readonly plugin: Definition;
  readonly container: BoxRenderable;
  readonly controller: AbortController;
  readonly cleanups: Cleanup[];
  readonly slots: Map<string, { readonly render: Slot; readonly container: BoxRenderable }>;
  active: boolean;
}

/** OpenCode #39776's resolve/compare/swap lifecycle over Nyte's native renderables. */
export class PluginProvider {
  readonly container: BoxRenderable;
  private readonly shell: Shell;
  private readonly workspace: TrustedWorkspace;
  private readonly client: Nyte;
  private readonly sessionID: () => SessionId | undefined;
  private readonly watcher: ReturnType<typeof createSourceWatcher>;
  private readonly sources: PluginSources<Definition>;
  private readonly registrations = new Map<string, Registration>();
  private readonly candidates = new Set<Registration>();
  private readonly setupBudgetMs: number;
  private readonly memories = new Map<string, Map<string, { value: JsonValue }>>();
  private readonly listeners = new Map<Registration, Set<(event: SessionEvent) => void>>();
  private readonly failures = new Map<string, string>();
  private readonly attempts = new Map<string, string>();
  private loading = Promise.resolve();
  private pending: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private disposal: Promise<void> | undefined;

  constructor(input: {
    readonly shell: Shell;
    readonly workspace: TrustedWorkspace;
    readonly client: Nyte;
    readonly sessionID: () => SessionId | undefined;
    readonly setupBudgetMs?: number;
  }) {
    this.shell = input.shell;
    this.workspace = input.workspace;
    this.client = input.client;
    this.sessionID = input.sessionID;
    this.setupBudgetMs = input.setupBudgetMs ?? 5_000;
    this.container = new BoxRenderable(input.shell.renderer, {
      id: "tui-plugins",
      width: "100%",
      flexShrink: 0,
      flexDirection: "column",
    });
    input.shell.pluginSlot.add(this.container);
    this.watcher = createSourceWatcher(() => {
      clearTimeout(this.pending);
      this.pending = setTimeout(() => {
        void this.reconcile().catch((cause: unknown) => this.report("plugins", cause));
      }, 100);
    });
    this.sources = createPluginSources((entry, track, instance) => {
      const prepared = prepareSource(entry, track, instance);
      return {
        async load(): Promise<Definition> {
          const exported: unknown = await (await prepared).load();
          if (!Value.Check(ModuleNamespace, exported))
            throw new TypeError("TUI plugin module must export an object");
          const definition = exported.default;
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
    }, this.watcher.wait);
    input.shell.renderer.on(CliRenderEvents.RENDER_ERROR, this.onRenderError);
  }

  registered(): readonly { readonly id: string; readonly target: string }[] {
    return [...this.registrations.values()].map((item) => ({
      id: item.plugin.id,
      target: item.target,
    }));
  }

  reconcile(options: { readonly retry?: boolean } = {}): Promise<void> {
    const result = this.loading.then(async () => {
      if (this.disposed) return;
      if (options.retry === true) this.sources.invalidate();
      await Promise.all(
        pluginDirectories({ kind: "project", workspace: this.workspace }).map((directory) =>
          this.watcher.wait(directory.path),
        ),
      );
      await Promise.all(
        manifestPaths({ kind: "project", workspace: this.workspace }).map(this.watcher.wait),
      );
      const units = await discoverPluginUnits(
        pluginDirectories({ kind: "project", workspace: this.workspace }),
      );
      const entrypoints = new Set(units.flatMap((unit) => unit.entries.tui ?? []));
      this.sources.retain(entrypoints);

      for (const retained of [this.failures, this.attempts]) {
        for (const target of retained.keys()) {
          if (!entrypoints.has(target)) retained.delete(target);
        }
      }

      const disabled = new Set(
        (await readManifest({ kind: "project", workspace: this.workspace })).plugins?.flatMap(
          (entry) => (entry.startsWith("-") ? [entry.slice(1)] : []),
        ) ?? [],
      );

      const desired = new Map<
        string,
        { readonly target: string; readonly version: string; readonly plugin: Definition }
      >();

      for (const unit of units) {
        const target = unit.entries.tui;
        if (target === undefined || disabled.has(unit.id)) continue;
        try {
          const loaded = await this.sources.read(target);
          const definition = loaded.value;
          if (definition.id !== unit.id)
            throw new Error(`plugin id "${definition.id}" must match directory name "${unit.id}"`);

          desired.set(definition.id, { target, version: loaded.version, plugin: definition });
        } catch (cause) {
          if (options.retry === true)
            throw new Error(
              `${target}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          this.report(target, cause);
          return;
        }
      }

      if (this.disposed) return;

      for (const [id, previous] of this.registrations) {
        if (desired.has(id)) continue;
        await this.deactivate(previous);
        this.registrations.delete(id);
        this.memories.delete(id);
        this.attempts.delete(previous.target);
      }

      for (const [id, desiredPlugin] of desired) {
        if (this.disposed) return;
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
          controller: new AbortController(),
          cleanups: [],
          slots: new Map(),
          active: false,
        };

        this.candidates.add(item);
        try {
          await this.setup(item);

          if (this.disposed || item.controller.signal.aborted) {
            await this.deactivate(item);

            return;
          }

          if (previous !== undefined) {
            this.container.insertBefore(item.container, previous.container);
            await this.deactivate(previous);
          } else this.container.add(item.container);
          if (this.disposed || item.controller.signal.aborted) {
            await this.deactivate(item);
            return;
          }
          item.active = true;
          this.registrations.set(id, item);
          this.failures.delete(item.target);
        } catch (cause) {
          await this.deactivate(item);
          if (this.disposed) return;
          if (options.retry === true)
            throw new Error(
              `${item.target}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          this.report(item.target, cause);
        } finally {
          this.candidates.delete(item);
        }
      }
    });

    this.loading = result.catch(() => undefined);

    return result;
  }

  refresh(): void {
    if (this.disposed) return;
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
      if (!item.active || item.controller.signal.aborted) continue;

      for (const listener of listeners) {
        try {
          listener(event);
        } catch (cause) {
          this.report(item.target, cause);
        }
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.disposed = true;
    clearTimeout(this.pending);
    this.watcher.dispose();
    for (const item of [...this.candidates, ...this.registrations.values()])
      item.controller.abort();
    this.disposal = this.loading.then(async () => {
      for (const item of this.registrations.values()) await this.deactivate(item);
      this.registrations.clear();
      this.sources.dispose();
      this.memories.clear();
      this.failures.clear();
      this.attempts.clear();
      this.shell.renderer.off(CliRenderEvents.RENDER_ERROR, this.onRenderError);
      this.container.destroyRecursively();
    });
    return this.disposal;
  }

  private async setup(item: Registration): Promise<void> {
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(() => {
      const error = new Error(
        `TUI plugin ${item.plugin.id} setup exceeded ${String(this.setupBudgetMs)}ms`,
      );
      item.controller.abort(error);
      deadline.reject(error);
    }, this.setupBudgetMs);
    const task = Promise.resolve()
      .then(() => {
        item.controller.signal.throwIfAborted();
        return item.plugin.setup(this.createPluginContext(item));
      })
      .then(async (cleanup) => {
        if (cleanup === undefined) return;
        if (item.controller.signal.aborted) {
          await cleanup();
          return;
        }
        item.cleanups.push(cleanup);
      });
    try {
      await Promise.race([task, deadline.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private createPluginContext(item: Registration): Context {
    const { shell } = this;
    const memory = this.memories.get(item.plugin.id) ?? new Map<string, { value: JsonValue }>();
    this.memories.set(item.plugin.id, memory);
    const assertLive = (): void => {
      item.controller.signal.throwIfAborted();
      if (this.disposed) throw new Error("TUI plugin provider is disposed");
    };

    return {
      signal: item.controller.signal,
      renderer: this.shell.renderer,
      get theme() {
        return { fg: shell.theme.foreground, bg: shell.theme.background };
      },
      client: this.client,
      data: {
        listen: (handler) => {
          assertLive();
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
          assertLive();
          const state = memory.get(key) ?? { value: options.initial };
          memory.set(key, state);

          return [
            () => state.value,
            (value) => {
              assertLive();
              state.value = value;
            },
          ];
        },
      },
      ui: {
        toast: {
          show: (options) => {
            assertLive();
            notice(this.shell, options.message);
          },
        },
        slot: (name, render) => {
          assertLive();
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
            if (item.slots.get(name) !== slot) return;
            item.slots.delete(name);
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
    item.controller.abort();
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
      if (!item.container.isDestroyed) item.container.destroyRecursively();
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
