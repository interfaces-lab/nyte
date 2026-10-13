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
} from "@nyte-ai/sdk";
import { availableModels, findModel } from "../lib/catalog.ts";
import { shortId } from "../lib/format.ts";
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
      if (patch.model === undefined) return;
      void ports.host.setDefaultModel(choice.model).catch((error: unknown) => {
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

/** Host-wide: catalog generations, each listed once and guarded by generation in the reducer. */
export async function watchHost(context: HandlerContext): Promise<void> {
  const { ports, dispatch, scope } = context;

  await each(ports.host.catalog(), context.signal, (entry) => {
    const generation = (scope.catalogGeneration += 1);
    void entry
      .list()
      .then((catalog) => dispatch({ kind: "catalog", generation, catalog }))
      .catch((error: unknown) => {
        ports.log.write("watch", error);
      });
  });
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
  const mentions = await options.mentions.mentions(options.signal);
  const latest = read().facts.workspace;

  if (options.signal.aborted || latest.cwd !== cwd) return;
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

  return context.ports.host.create({ workspace, selection: null });
}
