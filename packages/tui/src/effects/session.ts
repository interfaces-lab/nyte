/**
 * The long-lived watches, as fact producers. A watch that throws or ends
 * becomes a `watch-ended` fact (a visible `failed` watch, retried by the
 * `retry-watch` intent, which runs `follow` again); it never leaves a dead
 * loop or an unresolved "first view" promise behind.
 *
 * The followed session's `SessionConfigurator` lives here too: it orders
 * configuration before the sends pressed under it, and its optimistic
 * selection reaches the screen as `selection` facts.
 */
import type {
  Configuration,
  ModelCatalogView,
  ModelRef,
  SessionId,
  SessionInfo,
  Thinking,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { availableModels, clampThinking, findModel } from "../lib/catalog.ts";
import { shortId } from "../lib/format.ts";
import { indexedMention } from "../model/completion.ts";
import type { Selection, State, WorkspaceFacts } from "../model/state.ts";
import { SessionConfigurator } from "../services/session-config.ts";
import type { ConfigPatch, RunChoice } from "../services/session-config.ts";
import { readWorkspaceStatus } from "../services/workspace.ts";
import { messageOf } from "./runner.ts";
import type { HandlerContext } from "./runner.ts";

const PLACEHOLDER_SELECTION: Selection = {
  model: { provider: "none", id: "none" },
  effort: "medium",
  fast: false,
};

export async function follow(
  target: SessionId | "new",
  announce: boolean,
  context: HandlerContext,
): Promise<void> {
  const { ports, dispatch, read, scope } = context;
  scope.followed?.controller.abort();
  const controller = new AbortController();
  const stopOnDispose = (): void => controller.abort();
  context.signal.addEventListener("abort", stopOnDispose, { once: true });
  const id = target === "new" ? await created(context) : target;
  const port = ports.host.session(id);
  const info = await port.info();

  if (controller.signal.aborted) return;

  const configurator = new SessionConfigurator({
    configure: (patch) => port.configure(configurePatch(patch)),
    readSelected: () => toRunChoice(selectionOf(read(), id) ?? fallback(read())),
    onChange: (selected) =>
      dispatch({
        kind: "selection",
        session: id,
        selection: toSelection(selected, catalogOf(read())),
      }),
    onAcknowledged: (choice, patch) => {
      if (patch.model !== undefined)
        void ports.host.setDefaultModel(choice.model).catch((error: unknown) => {
          ports.log.write("effect", error);
        });

      if (patch.thinkingLevel !== undefined)
        void rememberThinking(choice.thinkingLevel, context).catch((error: unknown) => {
          ports.log.write("effect", error);
        });
    },
  });

  scope.followed = { id, controller, configurator };
  dispatch({ kind: "session-opened", session: id, info, selection: fallback(read()) });
  let first = true;

  const views = each(port.watch(), controller.signal, (view) => {
    dispatch({ kind: "view", session: id, view });
    const selected = choiceOf(view.configuration.selected ?? view.configuration.effective);

    if (selected !== null) configurator.observeSelected(selected);
    const shown = toSelection(configurator.selected, catalogOf(read()));
    const current = read().facts.session;

    if (current?.id === id && !sameSelection(current.selection, shown))
      dispatch({ kind: "selection", session: id, selection: shown });

    if (!first) return;
    first = false;
    void ports.plugins.switched(scope.previous, id).catch((error: unknown) => {
      ports.log.write("plugin", error);
    });

    scope.previous = id;

    if (announce)
      dispatch({
        kind: "inform",
        tone: "info",
        text: `Resumed ${shortId(id)} · ${String(view.turns.length)} turns`,
      });
  });

  const tasks = each(ports.host.tasks(id), controller.signal, (list) => {
    dispatch({ kind: "tasks", session: id, tasks: list });
  });

  const ended = (failure: string | null): void => {
    if (controller.signal.aborted) return;
    controller.abort();
    dispatch({ kind: "watch-ended", session: id, failure });
  };

  for (const loop of [views, tasks]) {
    const tracked: Promise<void> = loop
      .then(() => ended(null))
      .catch((error: unknown) => {
        ports.log.write("watch", error);
        ended(messageOf(error));
      })
      .finally(() => {
        scope.watches.delete(tracked);
        context.signal.removeEventListener("abort", stopOnDispose);
      });

    scope.watches.add(tracked);
  }

  const workspace = await port.workspace();

  if (workspace.cwd !== null && !controller.signal.aborted)
    await refreshWorkspace(context, workspace.cwd, { mentions: port, signal: controller.signal });

  unavailable(info.activation, dispatch);
}

/**
 * Host-wide: catalog generations, each listed once and guarded by generation
 * in the reducer; and the session directory, so a rename of the followed chat
 * (automatic naming included) reaches the terminal title.
 */
export async function watchHost(context: HandlerContext): Promise<void> {
  const { ports, dispatch, read, scope } = context;

  const catalogs = each(ports.host.catalog(), context.signal, (entry) => {
    const generation = (scope.catalogGeneration += 1);
    void entry
      .list()
      .then((catalog) => dispatch({ kind: "catalog", generation, catalog }))
      .catch((error: unknown) => {
        ports.log.write("watch", error);
      });
  });

  const renames = each(ports.host.sessionInfos(), context.signal, (sessions) => {
    const followed = read().facts.session;
    const info = sessions.find((candidate) => candidate.id === followed?.id);

    if (followed === null || info === undefined || info.name === followed.info.name) return;
    dispatch({ kind: "session-info", session: followed.id, info });
  });

  await Promise.all([catalogs, renames]);
}

/**
 * Git facts for a folder, keeping the `@` index when the folder is the one
 * already indexed; with `mentions`, the index is rebuilt from the workspace
 * scan once the git facts are out.
 */
export async function refreshWorkspace(
  context: HandlerContext,
  cwd: string,
  options?: {
    readonly mentions: { mentions(signal: AbortSignal): Promise<readonly string[]> };
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const { dispatch, read } = context;
  const status = await readWorkspaceStatus(cwd);
  const known = read().facts.workspace;

  const facts: WorkspaceFacts = {
    cwd,
    branch: status.branch ?? null,
    dirty: status.dirty,
    mentions: known.cwd === cwd ? known.mentions : null,
  };

  dispatch({ kind: "workspace", workspace: facts });

  if (options === undefined || facts.mentions !== null || options.signal.aborted) return;
  const entries = await options.mentions.mentions(options.signal);
  const latest = read().facts.workspace;

  if (options.signal.aborted || latest.cwd !== cwd) return;
  const mentions = entries.map((entry) => indexedMention(cwd, entry));
  dispatch({ kind: "workspace", workspace: { ...latest, mentions } });
}

/** Iterates until the source ends or the signal aborts; an abort stops waiting on `next()` and returns the iterator. */
export async function each<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
  next: (value: T) => void,
): Promise<void> {
  if (signal.aborted) return;
  const iterator = source[Symbol.asyncIterator]();

  const aborted = new Promise<"aborted">((resolve) => {
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), aborted]);

      if (step === "aborted" || step.done === true) return;
      next(step.value);
    }
  } finally {
    void iterator.return?.();
  }
}

export function selectionOf(state: State, session: SessionId): Selection | null {
  const followed = state.facts.session;

  if (followed === null || followed.id !== session || followed.view === null) return null;
  const { selected: chosen, effective } = followed.view.configuration;
  const selected = choiceOf(chosen ?? effective);

  return selected === null ? null : toSelection(selected, catalogOf(state));
}

/** The selection a session shows before its first view: the last one seen, else the catalog's default. */
export function fallback(state: State): Selection {
  const followed = state.facts.session;
  const configuration = followed?.view?.configuration;
  const selected = choiceOf(configuration?.selected ?? configuration?.effective ?? null);

  if (selected !== null) return toSelection(selected, catalogOf(state));

  return (
    fallbackSelection(catalogOf(state), followed?.selection.effort ?? "medium") ??
    PLACEHOLDER_SELECTION
  );
}

/** The catalog's default model, else the first available, else the first known; null when the catalog has none. */
export function fallbackSelection(
  catalog: ModelCatalogView | null,
  effort: Thinking,
): Selection | null {
  if (catalog === null) return null;

  const model =
    catalog.default ??
    availableModels(catalog)[0]?.ref ??
    catalog.providers.flatMap((provider) => provider.models)[0]?.ref;

  return model === undefined ? null : toSelection({ model, thinkingLevel: effort }, catalog);
}

export function toRunChoice(selection: Selection): RunChoice {
  return { model: selection.model, thinkingLevel: selection.effort };
}

/** `fast` is a fact about the model ref: whether some base model names it as its fast sibling. */
export function toSelection(choice: RunChoice, catalog: ModelCatalogView | null): Selection {
  const fast =
    catalog !== null &&
    catalog.providers.some((provider) =>
      provider.models.some((model) => model.fast !== null && sameRef(model.fast, choice.model)),
    );

  return { model: choice.model, effort: choice.thinkingLevel, fast };
}

/** Resolves a partial selection against the catalog: `fast` picks the base model's fast sibling, or the base again. */
export function patchOf(
  selection: Partial<Selection>,
  current: Selection,
  catalog: ModelCatalogView | null,
): ConfigPatch {
  const model = selection.model ?? current.model;
  const fast = selection.fast ?? current.fast;
  const resolved = resolveModel(model, fast, catalog);
  const changed = !sameRef(resolved, current.model);

  return {
    ...(changed || selection.model !== undefined ? { model: resolved } : {}),
    ...(selection.effort === undefined ? {} : { thinkingLevel: selection.effort }),
  };
}

function resolveModel(model: ModelRef, fast: boolean, catalog: ModelCatalogView | null): ModelRef {
  if (catalog === null) return model;
  const models = catalog.providers.flatMap((provider) => provider.models);
  const base = models.find((info) => info.fast !== null && sameRef(info.fast, model));
  const info = findModel(models, model);

  if (fast) return info?.fast ?? model;

  return base?.ref ?? model;
}

function configurePatch(patch: ConfigPatch): {
  readonly model?: ModelRef;
  readonly effort?: Thinking;
} {
  return {
    ...(patch.model === undefined ? {} : { model: patch.model }),
    ...(patch.thinkingLevel === undefined ? {} : { effort: patch.thinkingLevel }),
  };
}

function choiceOf(configuration: Configuration | null): RunChoice | null {
  return configuration === null
    ? null
    : { model: configuration.model, thinkingLevel: configuration.thinking };
}

function catalogOf(state: State): ModelCatalogView | null {
  return state.facts.catalog.catalog;
}

function sameSelection(left: Selection, right: Selection): boolean {
  return (
    sameRef(left.model, right.model) && left.effort === right.effort && left.fast === right.fast
  );
}

function sameRef(left: ModelRef, right: ModelRef): boolean {
  return left.provider === right.provider && left.id === right.id;
}

function unavailable(
  activation: SessionInfo["activation"],
  dispatch: HandlerContext["dispatch"],
): void {
  if (activation.kind === "unavailable")
    dispatch({
      kind: "inform",
      tone: "warning",
      text:
        activation.reason === "unreachable"
          ? "Couldn't reach this session's workspace"
          : "Can't open this session's workspace",
    });

  if (activation.kind === "failed")
    dispatch({
      kind: "inform",
      tone: "error",
      text: `Workspace failed to activate: ${activation.message}`,
    });
}

async function created(context: HandlerContext): Promise<SessionId> {
  const workspace = context.read().facts.session?.info.workspace ?? null;

  return createSession({ workspace, selection: null, effort: null }, context);
}

/**
 * Creates a session and configures it at the remembered thinking level,
 * clamped to its model, before anything follows it; an `effort` the command
 * line chose wins and is created with instead.
 */
export async function createSession(
  input: {
    readonly workspace: WorkspaceId | null;
    readonly selection: Selection | null;
    readonly effort: Thinking | null;
  },
  context: HandlerContext,
): Promise<SessionId> {
  const { ports, read } = context;
  const id = await ports.host.create({ workspace: input.workspace, selection: input.selection });
  const remembered = read().facts.settings.thinkingLevel;

  if (input.effort !== null || remembered === undefined) return id;
  const catalog = catalogOf(read());
  const model = input.selection?.model ?? fallbackSelection(catalog, remembered)?.model;
  const info =
    model === undefined || catalog === null
      ? undefined
      : findModel(availableModels(catalog), model);
  const effort = info === undefined ? remembered : clampThinking(info, remembered);
  const outcome = await ports.host.session(id).configure({ effort });

  if (outcome.kind !== "configured")
    ports.log.write("effect", new Error(`Couldn't start at ${effort} thinking: ${outcome.kind}`));

  return id;
}

async function rememberThinking(level: Thinking, context: HandlerContext): Promise<void> {
  const { ports, read, dispatch } = context;

  if (read().facts.settings.thinkingLevel === level) return;
  const settings = await ports.settings.write(read().facts.workspace.cwd, { thinkingLevel: level });
  dispatch({ kind: "settings", settings });
}
