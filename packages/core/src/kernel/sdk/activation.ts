import { type Api, type Model, type RetryPolicy } from "@nyte-ai/ai";
import type { JsonValue, Skill } from "@nyte-ai/schema";
import type { PluginSessionStorage } from "../../plugins/api.ts";
import type { PluginSession } from "../../plugins/types.ts";
import { HookRegistry } from "../../plugins/hooks.ts";
import {
  createRegistries,
  PluginHost,
  type PluginEventSource,
  type PluginRegistries,
  type PluginHostTarget,
  type PluginNotice,
} from "../../plugins/host.ts";
import { withBudget } from "../../plugins/scope.ts";
import { pluginFactKey, storedChoice } from "../../plugins/storage.ts";
import type {
  Agent,
  ApplySettingOutcome,
  Command,
  CommandResult,
  Disposer,
  Plugin,
  PluginInfo,
  PluginReplacement,
  SessionTransition,
  SettingInfo,
} from "../../plugins/types.ts";
import {
  isThinkingLevel,
  type AgentContext,
  type AgentTool,
  type ExecutableTool,
  type ThinkingLevel,
} from "../loop/types.ts";
import { toolOutcome } from "../loop/tool-result.ts";
import type { StreamOptions } from "../stream-options.ts";
import type { CompactionSettings } from "../compaction.ts";
import { isJsonObject, toJsonValue } from "@nyte-ai/client";
import { isTerminalPhase } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getSystemMessageText,
} from "@nyte-ai/schema";
import type { Message, SystemMessage } from "@nyte-ai/schema";
import type { Blob, ModelRef, Obj, Run, RunConfig } from "../model.ts";
import { contextMessages } from "@nyte-ai/client";
import { contextCommits } from "../graph.ts";
import { FACT_PREFIX, decodeFactKey, encodeFactKey, factRef, headRef, runRef } from "../names.ts";
import type { Session } from "../store.ts";
import type { ExecutionEnv } from "../loop/env.ts";
import { wrappedEnvironment } from "../../plugins/environment.ts";
import { projectEvent } from "./events.ts";
import { providerCompactionFor, requestStream, type RequestStreamFn } from "./requests.ts";
import { NAME_FACT, PARENT_FACT } from "./snapshot.ts";
import { MAIN, type SessionEvent } from "./types.ts";
import { bindTurn, type Turn, type TurnInput, type TurnOptions } from "../turn.ts";

const REGISTRY_PROPERTIES = [
  // `agents` first: the `subagents` builtin reads it while contributing `tools`.
  "agents",
  "tools",
  "commands",
  "prompt",
  "resources",
  "settings",
  "status",
  "modelContext",
  "environmentWraps",
] satisfies readonly (keyof PluginRegistries)[];

export type Notice = PluginNotice;

/** Wall-clock budget for a plugin command or event listener, like a disposer's. */
const PLUGIN_CALL_BUDGET_MS = 5_000;

export interface Activation {
  readonly registries: PluginRegistries;
  readonly hooks: HookRegistry;
  readonly plugins: PluginHost;
  /** Where this activation's tools and plugins act: the opened environment through the plugins' wraps. */
  readonly env: ExecutionEnv;
  /** The contributed tools, each bound to `env` outside every plugin's wrap. */
  tools(): readonly ExecutableTool[];
  /** The prompt registry as named, ordered sections: what `SystemMessage.sections` declares. */
  promptSections(): Record<string, string>;
  /** The rendered prompt, as the model reads it once declared. */
  systemPrompt(): string;
  agents(): readonly Agent[];
  commands(): ReadonlyMap<string, Command>;
  commandOwner(name: string): string | undefined;
  resources(): ReadonlyMap<string, Skill>;
  listSettings(): Promise<readonly SettingInfo[]>;
  applySetting(id: string, choiceId: string): Promise<ApplySettingOutcome>;
  /** The plugin status items in display order. */
  statuses(): readonly string[];
  runCommand(name: string, argument?: string): Promise<CommandResult>;
  setPlugins(plugins: readonly Plugin[], applied?: () => void): Promise<PluginReplacement>;
  observeRun(run: Run): void;
  offeredTurn(runId: string): TurnResolution | undefined;
  offerTurn(input: TurnInput, resolution: TurnResolution, attempt?: number): void;
  releaseTurn(runId: string): void;
  duringCall<T>(call: () => T | Promise<T>): Promise<T>;
  subscribe(listener: (notice: Notice) => void): Disposer;
  close(): Promise<void>;
}

interface FactsShim extends Omit<PluginSessionStorage, keyof PluginSession> {
  listFacts(
    prefix: string,
  ): Promise<readonly { readonly fact: string; readonly value: JsonValue }[]>;
}

export type ActivationTarget =
  | { readonly kind: "new-session" }
  | { readonly kind: "session"; readonly session: Session };

function isBlob(object: Obj | undefined): object is Blob {
  return object?.kind === "blob";
}

async function blobValue(session: Session, oid: string, ref: string): Promise<JsonValue> {
  const object = await session.objects.get(oid);

  if (!isBlob(object)) throw new Error(`Corrupt fact ref ${ref} at ${oid}`);

  return object.value;
}

function storedFactRef(key: string): string {
  return factRef(encodeFactKey(key));
}

function factsFor(session: Session): FactsShim {
  return {
    getFact: async (key) => {
      const ref = storedFactRef(key);
      const oid = await session.refs.read(ref);

      return oid === null ? undefined : blobValue(session, oid, ref);
    },
    setFact: async (key, value) => {
      const ref = storedFactRef(key);

      const blob: Blob | undefined =
        value === undefined ? undefined : { kind: "blob", value: toJsonValue(value) };

      const written = blob === undefined ? undefined : await session.objects.put([blob]);
      const next = written?.[0] ?? null;

      for (;;) {
        const current = await session.refs.read(ref);

        const outcome = await session.refs.update([{ name: ref, from: current, to: next }], {
          reason: "fact",
        });

        if (outcome.ok) return;

        switch (outcome.reason) {
          case "conflict":
            continue;
          case "fenced":
            throw new Error(`Fact update was fenced: ${ref}`);
          default: {
            const _exhaustive: never = outcome;

            return _exhaustive;
          }
        }
      }
    },
    listFacts: async (prefix) => {
      const refs = await session.refs.list(
        prefix === "" ? FACT_PREFIX : factRef(encodeFactKey(prefix)),
      );

      return Promise.all(
        refs.map(async (ref) => ({
          fact: decodeFactKey(ref.name.slice(FACT_PREFIX.length)),
          value: await blobValue(session, ref.oid, ref.name),
        })),
      );
    },
  };
}

function transientFacts(): FactsShim {
  const facts = new Map<string, JsonValue>();

  return {
    getFact: (key) => Promise.resolve(facts.get(key)),
    setFact: (key, value) => {
      if (value === undefined) facts.delete(key);
      else facts.set(key, value);

      return Promise.resolve();
    },
    listFacts: (prefix) =>
      Promise.resolve(
        facts
          .entries()
          .filter(([fact]) => fact.startsWith(prefix))
          .map(([fact, value]) => ({ fact, value }))
          .toArray(),
      ),
  };
}

/** Activate a plugin list for a real session or a transient prospective session. */
/** What activating a plugin set yields: a session that can run, or the plugin that stopped it. */
export type ActivationOutcome =
  | { readonly kind: "active"; readonly activation: Activation }
  | { readonly kind: "failed"; readonly error: string; readonly plugins: readonly PluginInfo[] };

export async function activate(input: {
  target: ActivationTarget;
  plugins: readonly Plugin[];
  env: ExecutionEnv;
  /** Hears every notice, including those plugins emit while they instantiate. */
  onNotice?: (notice: Notice) => void | Promise<void>;
}): Promise<ActivationOutcome> {
  const registries = createRegistries();
  const env = wrappedEnvironment(input.env, () => registries.environmentWraps.values());
  const executable = new WeakMap<AgentTool, ExecutableTool>();
  let initializing = true;
  const session = input.target.kind === "session" ? input.target.session : undefined;
  const facts = session === undefined ? transientFacts() : factsFor(session);
  const listeners = new Set<(notice: Notice) => void | Promise<void>>();

  if (input.onNotice !== undefined) listeners.add(input.onNotice);
  let closePromise: Promise<void> | undefined;
  const offered = new Map<string, { head: string; attempt: number; resolution: TurnResolution }>();
  const blockedHeads = new Map<string, string>();
  const calls = new Set<Promise<void>>();
  let pending: (() => void) | undefined;
  let pendingRebuild = false;
  const deferred: (() => void)[] = [];
  let flushing = false;
  const flush = (): void => {
    if (flushing || calls.size || offered.size || blockedHeads.size || closePromise !== undefined)
      return;
    flushing = true;
    try {
      while (deferred.length) for (const action of deferred.splice(0)) action();
      const commit = pending;
      pending = undefined;
      if (pendingRebuild) {
        pendingRebuild = false;
        if (commit === undefined) rebuildAll();
      }
      commit?.();
      while (deferred.length && !calls.size && !offered.size && !blockedHeads.size) {
        for (const action of deferred.splice(0)) action();
      }
      if (eventListeners.size === 0 && transitionListeners.size === 0) {
        eventLoop?.abort();
        eventLoop = undefined;
      }
    } finally {
      flushing = false;
    }
  };
  const duringCall = async <T>(call: () => T | Promise<T>): Promise<T> => {
    if (closePromise !== undefined) throw new Error("activation is closed");
    const { promise, resolve } = Promise.withResolvers<void>();
    calls.add(promise);
    try {
      return await call();
    } finally {
      calls.delete(promise);
      resolve();
      flush();
    }
  };

  const emit = async (notice: Notice): Promise<void> => {
    for (const listener of listeners) {
      try {
        await listener(notice);
      } catch (error) {
        if (notice.kind === "diagnostic") continue;
        await emit({
          kind: "diagnostic",
          level: "error",
          owner: `listener ${notice.kind}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const hooks = new HookRegistry((error, hook) =>
    emit({
      kind: "diagnostic",
      owner: hook === "before_compaction" ? "compaction" : `hook ${hook}`,
      level: hook === "before_compaction" ? "warn" : "error",
      message: error.message,
    }),
  );

  const statuses = (): string[] =>
    registries.status
      .values()
      .map((item, index) => ({ item, index }))
      .sort(
        (left, right) =>
          (left.item.order ?? 100) - (right.item.order ?? 100) || left.index - right.index,
      )
      .map(({ item }) => item.text);

  let shownStatuses = statuses().join("\u0000");

  const emitStatuses = (): void => {
    const items = statuses();
    const signature = items.join("\u0000");
    if (signature === shownStatuses) return;
    shownStatuses = signature;
    void emit({ kind: "status_changed", items });
  };

  const rebuildAll = (): void => {
    if (calls.size || offered.size || blockedHeads.size) {
      pendingRebuild = true;
      return;
    }
    for (const property of REGISTRY_PROPERTIES) {
      for (const failure of registries[property].rebuild().errors) {
        void emit({
          kind: "diagnostic",
          level: "error",
          owner: failure.owner,
          message: failure.message,
        });
      }
    }
    emitStatuses();
  };

  // One watch over the session's events, started by the first subscriber and
  // fanned out to every plugin listener. A listener that throws is reported
  // and the stream goes on: an observer cannot stop what it observes.
  const eventListeners = new Set<(event: SessionEvent) => void | Promise<void>>();
  const transitionListeners = new Set<(transition: SessionTransition) => void | Promise<void>>();
  // A run ref is rewritten after its phase is final and a parked effect after
  // it waits, so each transition is remembered and delivered once.
  const endedRuns = new Set<string>();
  const openWaits = new Set<string>();
  const transitionsOf = (event: SessionEvent): SessionTransition[] => {
    if (event.kind === "run") {
      const { phase } = event.run;

      if (phase.kind !== "done" && phase.kind !== "aborted" && phase.kind !== "failed") return [];
      if (endedRuns.has(event.run.runId)) return [];
      endedRuns.add(event.run.runId);

      return [{ kind: "run_ended", head: event.head, run: { ...event.run, phase } }];
    }

    if (event.kind !== "effect" || event.state !== "waiting" || event.selection === undefined)
      return [];
    if (openWaits.has(event.waitId)) return [];
    openWaits.add(event.waitId);
    const { seq: _seq, state: _state, selection, ...wait } = event;

    return [{ ...wait, kind: "awaiting_reply", selection }];
  };
  const deliver = <T>(listeners: ReadonlySet<(item: T) => void | Promise<void>>, item: T): void => {
    for (const listener of listeners) {
      void withBudget({ what: "event listener", ms: PLUGIN_CALL_BUDGET_MS }, () =>
        duringCall(() => listener(item)),
      ).catch((cause: unknown) =>
        emit({
          kind: "diagnostic",
          level: "error",
          owner: "events",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  };
  let eventLoop: AbortController | undefined;
  let eventTask: Promise<void> | undefined;
  const recordRun = (name: string, run: Run | undefined): void => {
    if (run !== undefined && (run.phase.kind === "tools" || run.phase.kind === "waiting"))
      blockedHeads.set(name, run.id);
    else blockedHeads.delete(name);
    for (const [id, binding] of offered) {
      if (name !== runRef(binding.head)) continue;
      if (
        run === undefined ||
        run.id !== id ||
        isTerminalPhase(run.phase) ||
        (run.attempts >= binding.attempt &&
          run.phase.kind !== "tools" &&
          run.phase.kind !== "waiting")
      )
        offered.delete(id);
    }
    flush();
  };
  const observeRunRef = async (name: string): Promise<void> => {
    if (session === undefined) return;
    const oid = await session.refs.read(name);
    const object = oid === null ? undefined : await session.objects.get(oid);
    recordRun(name, object?.kind === "run" ? object : undefined);
  };

  const startEventLoop = (): void => {
    if (session === undefined || eventLoop !== undefined) return;
    const loop = new AbortController();
    eventLoop = loop;
    eventTask = (async () => {
      const afterSeq = await session.events.last();
      const heads = new Set([
        ...blockedHeads.keys(),
        ...offered.values().map((binding) => runRef(binding.head)),
      ]);
      for (const head of heads) await observeRunRef(head);
      const events = session.events.watch({ afterSeq, signal: loop.signal });

      for await (const event of events) {
        if (loop.signal.aborted) return;

        if (event.kind === "ref" && event.name.startsWith("refs/runs/"))
          await observeRunRef(event.name);
        for (const projected of await projectEvent(event, session.objects)) {
          deliver(eventListeners, projected);
          for (const transition of transitionsOf(projected))
            deliver(transitionListeners, transition);
        }
      }
    })().catch((cause: Error) => {
      if (loop.signal.aborted) return;
      void emit({ kind: "diagnostic", level: "error", owner: "events", message: cause.message });
    });
  };

  const events: PluginEventSource = {
    subscribe: (listener): Disposer => {
      eventListeners.add(listener);
      startEventLoop();

      return () => {
        eventListeners.delete(listener);
        flush();
      };
    },
    transitions: (listener): Disposer => {
      transitionListeners.add(listener);
      startEventLoop();

      return () => {
        transitionListeners.delete(listener);
        flush();
      };
    },
  };

  const subscribe = (listener: (notice: Notice) => void | Promise<void>): Disposer => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  };

  const target: PluginHostTarget = {
    hooks,
    registries,
    session: {
      ...facts,
      info: async () => {
        const name = await facts.getFact(NAME_FACT);
        const child = (await facts.getFact(PARENT_FACT)) !== undefined;
        const base = Value.Check(Type.String(), name) ? { name, child } : { child };

        return session === undefined ? base : { id: session.id, ...base };
      },
      rename: (name) => facts.setFact(NAME_FACT, name),
      context: async () => {
        if (session === undefined) return { systemPrompt: systemPrompt(), messages: [] };
        const tip = await session.refs.read(headRef(MAIN));
        const commits = await contextCommits(session.objects, tip);

        return {
          systemPrompt: systemPrompt(),
          messages: contextMessages(commits.map((item) => item.commit)),
        };
      },
    },
    events,
    env,
    subscribe,
    rebuildAll,
    defer: (action) => {
      deferred.push(action);
      flush();
    },
    publish: (commit) => {
      const publish = (): void => {
        commit();
        emitStatuses();
      };
      if (!initializing && (calls.size || offered.size || blockedHeads.size)) {
        pending = publish;
        startEventLoop();
        return false;
      }
      publish();
      return true;
    },
    emit,
  };

  const plugins = new PluginHost(target);

  const promptSections = (): Record<string, string> =>
    Object.fromEntries(
      [...registries.prompt.current()]
        .map(([id, section]) => [sectionName(id, section.order), section.text] as const)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );

  const systemPrompt = (): string => renderSections(promptSections());

  const activation: Activation = {
    registries,
    hooks,
    plugins,
    env,
    tools: () =>
      registries.tools.values().map((tool) => {
        const cached = executable.get(tool);

        if (cached !== undefined) return cached;

        const bound: ExecutableTool = {
          ...tool,
          execute: (args, call) => tool.execute(args, { ...call, env }),
        };

        executable.set(tool, bound);

        return bound;
      }),
    promptSections,
    systemPrompt,
    agents: () => registries.agents.values(),
    commands: () => registries.commands.current(),
    commandOwner: (name) => registries.commands.owner(name),
    resources: () => registries.resources.current(),
    statuses,
    listSettings: async () => {
      const settings = await Promise.all(
        [...registries.settings.current()].map(async ([id, setting]): Promise<SettingInfo[]> => {
          const owner = registries.settings.owner(id);

          if (owner === undefined) return [];
          const current = storedChoice(
            setting,
            await facts.getFact(pluginFactKey(owner, setting.key)),
          );

          return [{ id, owner, label: setting.label, choices: setting.choices, current }];
        }),
      );

      return settings.flat();
    },
    applySetting: async (id, choiceId) => {
      const setting = registries.settings.get(id);
      const owner = registries.settings.owner(id);

      if (setting === undefined || owner === undefined) return { kind: "not_found" };

      if (!setting.choices.some((choice) => choice.id === choiceId)) {
        return { kind: "invalid_choice" };
      }

      await facts.setFact(pluginFactKey(owner, setting.key), choiceId);

      return { kind: "applied" };
    },
    observeRun: (run) => recordRun(runRef(run.head), run),
    offeredTurn: (runId) => offered.get(runId)?.resolution,
    offerTurn: (input, resolution, attempt = input.run.attempts + 1) => {
      offered.set(input.run.id, { head: input.run.head, attempt, resolution });
      startEventLoop();
    },
    releaseTurn: (runId) => {
      offered.delete(runId);
      flush();
    },
    duringCall,
    runCommand: async (name, argument = "") => {
      const command = registries.commands.get(name);

      if (command === undefined) throw new Error(`unknown command: ${name}`);

      const result = await withBudget(
        { what: `command ${name}`, ms: PLUGIN_CALL_BUDGET_MS },
        (signal) => duringCall(() => command.run(argument, signal)),
      );

      return result ?? undefined;
    },
    setPlugins: (next, applied) => plugins.activate(next, applied),
    subscribe,
    close: () => {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async () => {
        const errors: unknown[] = [];
        pending = undefined;
        deferred.length = 0;
        await plugins.close().catch((cause: unknown) => errors.push(cause));
        await Promise.allSettled(calls);

        try {
          hooks.close(new Error("activation is closed"));
        } catch (error) {
          errors.push(error);
        }

        listeners.clear();
        eventLoop?.abort();
        await eventTask;
        eventListeners.clear();
        transitionListeners.clear();

        if (errors.length > 0) throw new AggregateError(errors, "Failed to close activation");
      })();

      return closePromise;
    },
  };

  try {
    const replacement = await plugins.activate(input.plugins);

    if (replacement.kind === "rejected") {
      const failed = { kind: "failed", error: replacement.error, plugins: plugins.list() } as const;
      await activation.close();

      return failed;
    }

    if (session !== undefined) {
      for (const ref of await session.refs.list("refs/runs/")) await observeRunRef(ref.name);
      if (blockedHeads.size) startEventLoop();
    }
    initializing = false;
    return { kind: "active", activation };
  } catch (error) {
    await activation.close().catch(() => undefined);
    throw error;
  }
}

export interface TurnResolutionDefaults {
  readonly model: Model<Api>;
  readonly resolveModel?: (ref: ModelRef) => Model<Api> | undefined;
  readonly thinkingLevel?: ThinkingLevel;
}

export interface TurnResolution {
  readonly catalogModel: Model<Api>;
  readonly model: Model<Api>;
  readonly compactAt: number | undefined;
  readonly agent: Agent | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly steps: number | undefined;
  /** The prompt the branch must declare: the registry sections, then the agent persona as `agent`. */
  readonly sections: Readonly<Record<string, string>>;
  readonly tools: readonly ExecutableTool[];
}

interface InvocationState {
  readonly input: TurnInput;
}

interface CachedTurn {
  readonly catalogModel: Model<Api>;
  readonly model: Model<Api>;
  readonly compactAt: number | undefined;
  readonly agent: Agent | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly sections: Readonly<Record<string, string>>;
  readonly tools: readonly ExecutableTool[];
  readonly turn: Turn;
}

/** Render sections as the transcript's replayed system message renders them. */
export function renderSections(sections: Readonly<Record<string, string>>): string {
  return getSystemMessageText({ role: "system", content: "", sections, timestamp: 0 });
}

/**
 * A section's name in the transcript: its order, then its registry id. Stored
 * objects keep their keys sorted, so the order rides in the name and sections
 * replay in registry order wherever the message is read; ties sort by id.
 */
function sectionName(id: string, order = 100): string {
  const rank = Math.min(9999, Math.max(0, Math.trunc(order)));

  return `${String(rank).padStart(4, "0")}-${id}`;
}

/** The persona section a preset layers onto the base prompt, never replacing it. It renders last. */
const AGENT_SECTION = sectionName("agent", 9999);

/** Resolve the model, agent, and thinking level declared by a branch. */
export function resolveTurnConfig(
  activation: Activation,
  defaults: TurnResolutionDefaults,
  config: RunConfig,
): TurnResolution {
  const agent =
    config.agent === undefined
      ? undefined
      : activation
          .agents()
          .find((candidate) => candidate.id === config.agent && candidate.disabled !== true);

  const model =
    config.model !== undefined
      ? (defaults.resolveModel?.(config.model) ?? defaults.model)
      : agent?.model !== undefined
        ? (defaults.resolveModel?.(agent.model) ?? defaults.model)
        : defaults.model;

  const policy = activation.registries.modelContext.get(`${model.provider}/${model.id}`);

  const thinkingLevel =
    config.thinkingLevel !== undefined && isThinkingLevel(config.thinkingLevel)
      ? config.thinkingLevel
      : defaults.thinkingLevel;

  const sections = activation.promptSections();
  const allowed = agent?.tools === undefined ? undefined : new Set(agent.tools);
  const tools = activation.tools();

  return {
    catalogModel: model,
    model: policy === undefined ? model : { ...model, contextWindow: policy.contextWindow },
    compactAt: policy?.compactAt,
    agent,
    thinkingLevel,
    steps: agent?.steps,
    sections:
      agent?.system === undefined ? sections : { ...sections, [AGENT_SECTION]: agent.system },
    tools: allowed === undefined ? tools : tools.filter((tool) => allowed.has(tool.name)),
  };
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameSections(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([name, text], index) => {
      const other = rightEntries[index];

      return other !== undefined && other[0] === name && other[1] === text;
    })
  );
}

function sameResolution(cached: CachedTurn, resolved: TurnResolution): boolean {
  return (
    cached.catalogModel === resolved.catalogModel &&
    cached.model.contextWindow === resolved.model.contextWindow &&
    cached.compactAt === resolved.compactAt &&
    cached.agent === resolved.agent &&
    cached.thinkingLevel === resolved.thinkingLevel &&
    sameSections(cached.sections, resolved.sections) &&
    sameItems(cached.tools, resolved.tools)
  );
}

function invocationFor(
  invocations: WeakMap<AbortSignal, InvocationState>,
  signal: AbortSignal | undefined,
): InvocationState {
  if (signal === undefined) throw new Error("Activation hook ran without a turn signal");
  const invocation = invocations.get(signal);

  if (invocation === undefined) throw new Error("Activation hook ran outside a turn invocation");

  return invocation;
}

async function duringInvocation<T>(
  invocations: WeakMap<AbortSignal, InvocationState>,
  state: InvocationState,
  call: () => Promise<T>,
): Promise<T> {
  invocations.set(state.input.signal, state);

  try {
    return await call();
  } finally {
    if (invocations.get(state.input.signal) === state) invocations.delete(state.input.signal);
  }
}

function sameMessages(left: readonly Message[], right: readonly Message[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

/**
 * Re-attach the prompt and tool state after a `transform_context` handler.
 * Handlers only see the conversation; the system messages belong to the
 * kernel. An unchanged conversation keeps every system message in place; a
 * changed one gets the replayed state as one leading message.
 */
function restoreSystemMessages(
  current: Message[],
  visible: readonly Message[],
  returned: Message[],
): Message[] {
  if (sameMessages(returned, visible)) return current;
  const head = getCurrentSystemMessage(current);

  return head ? [head, ...returned] : returned;
}

/**
 * Send a forced prompt as the provider's leading system prompt without
 * recording it. The forced text heads the request with the current tools, and
 * the system messages collapse into it, so the transcript keeps its structured
 * sections and only this request is projected.
 */
function forcePrompt(messages: readonly Message[], forced: string): Message[] {
  const current = getCurrentSystemMessage(messages);

  const head: SystemMessage = {
    role: "system",
    content: forced,
    timestamp: current?.timestamp ?? Date.now(),
  };

  if (current?.toolsAdded) head.toolsAdded = current.toolsAdded;

  return [head, ...messages.filter((message) => message.role !== "system")];
}

function toolArguments(toolName: string, args: JsonValue): Record<string, JsonValue> {
  if (!isJsonObject(args)) throw new Error(`tool ${toolName} received non-object arguments`);

  return args;
}

/** Bind one run-aware turn over a session activation. */
export function turnFor(
  activation: Activation,
  defaults: {
    readonly streamFn: RequestStreamFn;
    readonly model: Model<Api>;
    readonly resolveModel?: (ref: ModelRef) => Model<Api> | undefined;
    readonly thinkingLevel?: ThinkingLevel;
    readonly streamOptions?: StreamOptions;
    readonly retry?: RetryPolicy;
    readonly compaction?: CompactionSettings;
  },
) {
  const invocations = new WeakMap<AbortSignal, InvocationState>();
  const toolInvocations = new WeakMap<AgentContext, InvocationState>();
  const toolInvocation = (
    context: AgentContext,
    signal: AbortSignal | undefined,
  ): InvocationState => {
    const invocation = signal === undefined ? undefined : invocations.get(signal);
    if (invocation !== undefined) {
      toolInvocations.set(context, invocation);
      return invocation;
    }
    const nested = toolInvocations.get(context);
    if (nested === undefined) throw new Error("Activation hook ran outside a turn invocation");
    return nested;
  };
  const policyFailures = new Map<string, string>();
  const cache = new Map<string, CachedTurn>();

  const requests = {
    hooks: activation.hooks,
    invocation: (signal: AbortSignal | undefined) => {
      const { input } = invocationFor(invocations, signal);

      return {
        head: input.run.head,
        runId: input.run.id,
        sessionId: input.session.id,
        attempt: input.attempt,
      };
    },
    streamFn: defaults.streamFn,
    streamOptions: defaults.streamOptions,
  };

  const streamFn = requestStream({
    ...requests,
    step: "assistant",
  });

  const compactionStreamFn = requestStream({ ...requests, step: "compaction" });
  const providerCompaction = providerCompactionFor(requests);

  const cachedTurn = (resolved: TurnResolution): Turn => {
    const key = `${resolved.model.provider}/${resolved.model.id}\u0000${resolved.agent?.id ?? ""}`;
    const cached = cache.get(key);

    if (cached !== undefined && sameResolution(cached, resolved)) return cached.turn;

    const loop: NonNullable<TurnOptions["loop"]> = {
      transformContext: async (messages, signal) => {
        const invocation = invocationFor(invocations, signal);
        const { head, id: runId } = invocation.input.run;
        let current = messages;
        let forced: string | undefined;

        if (activation.hooks.has("transform_context")) {
          const visible = current.filter((message) => message.role !== "system");

          const result = await activation.hooks.run(
            "transform_context",
            { head, runId, messages: visible, systemPrompt: getCurrentSystemPrompt(current) },
            invocation.input.signal,
          );

          if (result?.messages !== undefined) {
            current = restoreSystemMessages(current, visible, result.messages);
          }

          forced = result?.systemPrompt;
        }

        if (activation.hooks.has("transform_transcript")) {
          const result = await activation.hooks.run(
            "transform_transcript",
            { head, runId, messages: current },
            invocation.input.signal,
          );

          current = result?.messages ?? current;
        }

        return forced === undefined ? current : forcePrompt(current, forced);
      },
      beforeToolCall: async ({ toolCall, args, context }, signal) => {
        const invocation = toolInvocation(context, signal);
        const priorFailure = policyFailures.get(invocation.input.run.id);

        if (priorFailure !== undefined) return { block: true, reason: priorFailure };
        const effectiveArgs = toolArguments(toolCall.name, toJsonValue(args));

        if (!activation.hooks.has("before_tool")) return undefined;

        const decision = await activation.hooks.run(
          "before_tool",
          {
            head: invocation.input.run.head,
            runId: invocation.input.run.id,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: effectiveArgs,
          },
          signal ?? invocation.input.signal,
        );

        switch (decision.action) {
          case "continue":
            return undefined;
          case "modify":
            return { args: decision.args };
          case "reject":
            return { block: true, reason: decision.message, cause: { kind: "denied" } };
          case "error":
            policyFailures.set(invocation.input.run.id, decision.message);

            return { block: true, reason: decision.message };
          default: {
            const _exhaustive: never = decision;

            return _exhaustive;
          }
        }
      },
      afterToolCall: async ({ toolCall, args, context, ...executed }, signal) => {
        const invocation = toolInvocation(context, signal);

        if (!activation.hooks.has("after_tool")) return undefined;
        const { result } = executed;

        const hookInput = {
          head: invocation.input.run.head,
          runId: invocation.input.run.id,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolArguments(toolCall.name, toJsonValue(args)),
          content: result.content,
          details: toJsonValue(result.details),
          structuredContent: result.structuredContent,
          outcome: toolOutcome(executed),
        };

        return activation.hooks.run(
          "after_tool",
          result.usage === undefined ? hookInput : { ...hookInput, usage: result.usage },
          signal ?? invocation.input.signal,
        );
      },
    };

    const turn = bindTurn({
      streamFn,
      model: resolved.model,
      sections: resolved.sections,
      tools: resolved.tools,
      env: activation.env,
      thinkingLevel: resolved.thinkingLevel,
      loop,
      retry: defaults.retry,
      compaction: defaults.compaction,
      compactAt: resolved.compactAt,
      compactionStreamFn,
      providerCompaction,
    });

    cache.set(key, {
      catalogModel: resolved.catalogModel,
      model: resolved.model,
      compactAt: resolved.compactAt,
      agent: resolved.agent,
      thinkingLevel: resolved.thinkingLevel,
      sections: resolved.sections,
      tools: resolved.tools,
      turn,
    });

    return turn;
  };

  const turn: Turn = {
    // The resolution offered here stays offered through `respond`: plugin
    // publication waits, so the request declares exactly what was prepared.
    prepare: async (input) => {
      activation.observeRun(input.run);
      const resolved = resolveTurnConfig(activation, defaults, input.run.config);
      const bound = cachedTurn(resolved);
      activation.offerTurn(input, resolved);
      return activation.duringCall(async () => {
        try {
          const prepare = bound.prepare;

          return await duringInvocation(invocations, { input }, () =>
            prepare === undefined ? Promise.resolve({ kind: "ready" }) : prepare(input),
          );
        } catch (cause) {
          activation.releaseTurn(input.run.id);
          throw cause;
        }
      });
    },
    respond: async (input) => {
      activation.observeRun(input.run);
      const resolved =
        activation.offeredTurn(input.run.id) ??
        resolveTurnConfig(activation, defaults, input.run.config);
      const bound = cachedTurn(resolved);
      activation.offerTurn(input, resolved);
      return activation.duringCall(async () => {
        try {
          const outcome = await duringInvocation(invocations, { input }, () =>
            bound.respond(input),
          );
          if (outcome.kind !== "tools") activation.releaseTurn(input.run.id);
          return outcome;
        } catch (cause) {
          activation.releaseTurn(input.run.id);
          throw cause;
        }
      });
    },
    tools: async (input) => {
      policyFailures.delete(input.run.id);
      const resolved =
        activation.offeredTurn(input.run.id) ??
        resolveTurnConfig(activation, defaults, input.run.config);
      const bound = cachedTurn(resolved);
      if (activation.offeredTurn(input.run.id) === undefined)
        activation.offerTurn(input, resolved, input.run.attempts);
      return activation.duringCall(() =>
        duringInvocation(invocations, { input }, () => bound.tools(input)),
      );
    },
  };

  return {
    turn,
    resolveConfig: (config: RunConfig): RunConfig => {
      const resolved = resolveTurnConfig(activation, defaults, config);

      return {
        ...config,
        model: { provider: resolved.model.provider, id: resolved.model.id },
        thinkingLevel: resolved.thinkingLevel ?? "off",
      };
    },
    stepsFor: (run: Run) => resolveTurnConfig(activation, defaults, run.config).steps,
    policyFailure: (runId: string) => policyFailures.get(runId),
  };
}
