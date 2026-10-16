import { asId } from "@nyte-ai/schema";
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
import { errorMessage, shortId } from "../lib/format.ts";
import { indexedMention } from "../model/completion.ts";
import { chatFolder, followedSession } from "../model/state.ts";
import type { BlankChat, Selection, State, WorkspaceFacts } from "../model/state.ts";
import { SessionConfigurator } from "../services/session-config.ts";
import type { ConfigPatch, RunChoice } from "../services/session-config.ts";
import { readWorkspaceStatus } from "../services/workspace.ts";
import type { HandlerContext, LocalHandlerContext } from "./scope.ts";

const HISTORY_PAGE = 200;

const PLACEHOLDER_SELECTION: Selection = {
  model: { provider: "none", id: "none" },
  effort: "medium",
  fast: false,
};

/** Opens a blank chat: a draft that the first send starts under `chat.id`. No session exists before then. */
export async function openBlank(chat: BlankChat, context: HandlerContext): Promise<void> {
  const { dispatch, scope } = context;
  scope.followed?.controller.abort();
  scope.followed = null;
  dispatch({ kind: "blank-opened", chat });
  await settleFolder(chat, context);
}

/** Registers a blank chat's launch folder with the host, then reads that workspace's branch and files. */
export async function settleFolder(chat: BlankChat, context: HandlerContext): Promise<void> {
  const workspace = context.ports.host.workspace(await blankWorkspace(chat, context));
  const cwd = await workspace.cwd();

  if (cwd !== null && !context.signal.aborted)
    await refreshWorkspace(context, cwd, { mentions: workspace, signal: context.signal });
}

/** The workspace a blank chat starts in; a chat still in its launch folder registers that folder first. */
export async function blankWorkspace(
  chat: BlankChat,
  context: HandlerContext,
): Promise<WorkspaceId> {
  if (chat.folder.kind === "folder") return chat.folder.id;
  const workspace = await context.ports.host.openFolder(null);
  context.dispatch({ kind: "blank-folder", session: chat.id, workspace });

  return workspace;
}

/** Opens a blank chat in the current chat's workspace, on the default model at the remembered thinking level. */
export async function openNew(context: HandlerContext): Promise<void> {
  const state = context.read();
  const { chat } = state.facts;
  const catalog = readCatalog(state);

  await openBlank(
    {
      kind: "blank",
      id: asId(crypto.randomUUID()),
      folder: chat === null ? { kind: "launch-folder" } : chatFolder(chat),
      selection:
        (catalog === null ? null : defaultSelection(catalog, state.facts.settings.thinkingLevel)) ??
        chat?.selection ??
        fallback(state),
    },
    context,
  );
}

/** The host's default model at the remembered thinking level, lowered to what the model supports; without one, at the level core would give it. */
export function defaultSelection(
  catalog: ModelCatalogView,
  remembered: Thinking | undefined,
): Selection | null {
  const selection = fallbackSelection(catalog, remembered ?? "off");

  const model =
    selection === null ? undefined : findModel(availableModels(catalog), selection.model);

  if (selection === null || model === undefined) return selection;

  return {
    ...selection,
    effort: remembered === undefined ? model.defaultThinking : clampThinking(model, remembered),
  };
}

export async function follow(
  id: SessionId,
  announce: boolean,
  context: HandlerContext,
): Promise<void> {
  const { ports, dispatch, read, scope } = context;
  scope.followed?.controller.abort();
  const controller = new AbortController();
  const stopOnDispose = (): void => controller.abort();
  context.signal.addEventListener("abort", stopOnDispose, { once: true });
  const port = ports.host.session(id);
  const info = await port.info();

  if (controller.signal.aborted) return;

  const configurator = new SessionConfigurator({
    configure: (patch) => port.configure(configurePatch(patch)),
    readSelected: () => toRunChoice(readSelection(read(), id) ?? fallback(read())),
    onChange: (selected) =>
      dispatch({
        kind: "selection",
        session: id,
        selection: toSelection(selected, readCatalog(read())),
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

  scope.followed = { id, port, controller, configurator };
  const started = read().facts.chat;

  dispatch({
    kind: "session-opened",
    session: id,
    info,
    selection: started?.id === id ? started.selection : fallback(read()),
  });
  let first = true;

  const views = each(port.watch(), controller.signal, (view) => {
    dispatch({ kind: "view", session: id, view });
    const selected = readRunChoice(view.configuration.selected ?? view.configuration.effective);

    if (selected !== null) configurator.observeSelected(selected);
    const shown = toSelection(configurator.selected, readCatalog(read()));
    const current = read().facts.chat;

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
        ended(errorMessage(error));
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

/** Pages older messages into the followed session's views once the transcript shows its first loaded row. */
export async function loadEarlier(
  effect: { readonly session: SessionId },
  context: HandlerContext,
): Promise<void> {
  const followed = context.scope.followed;

  if (followed?.id === effect.session) await followed.port.earlier(HISTORY_PAGE);
}

export async function watchHost(context: HandlerContext): Promise<void> {
  const { ports, dispatch, read, scope } = context;
  let seen = read().facts.catalog.catalog?.generation ?? null;

  const catalogs = each(ports.host.catalog(), context.signal, (entry) => {
    if (entry.catalog === seen) return;
    seen = entry.catalog;
    const generation = (scope.catalogGeneration += 1);
    void ports.host
      .listModels()
      .then((catalog) => dispatch({ kind: "catalog", generation, catalog }))
      .catch((error: unknown) => {
        ports.log.write("watch", error);
      });
  });

  const renames = each(ports.host.sessionInfos(), context.signal, (sessions) => {
    const followed = followedSession(read());
    const info = sessions.find((candidate) => candidate.id === followed?.id);

    if (followed === null || info === undefined || info.name === followed.info.name) return;
    dispatch({ kind: "session-info", session: followed.id, info });
  });

  await Promise.all([catalogs, renames]);
}

export async function refreshWorkspace(
  context: LocalHandlerContext,
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

async function each<T>(
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

export function readSelection(state: State, session: SessionId): Selection | null {
  const followed = followedSession(state);

  if (followed === null || followed.id !== session || followed.view === null) return null;
  const { selected: chosen, effective } = followed.view.configuration;
  const selected = readRunChoice(chosen ?? effective);

  return selected === null ? null : toSelection(selected, readCatalog(state));
}

export function fallback(state: State): Selection {
  const configuration = followedSession(state)?.view?.configuration;
  const selected = readRunChoice(configuration?.selected ?? configuration?.effective ?? null);

  if (selected !== null) return toSelection(selected, readCatalog(state));

  return (
    fallbackSelection(readCatalog(state), state.facts.chat?.selection.effort ?? "medium") ??
    PLACEHOLDER_SELECTION
  );
}

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

function toRunChoice(selection: Selection): RunChoice {
  return { model: selection.model, thinkingLevel: selection.effort };
}

export function toSelection(choice: RunChoice, catalog: ModelCatalogView | null): Selection {
  const fast =
    catalog !== null &&
    catalog.providers.some((provider) =>
      provider.models.some((model) => model.fast !== null && sameRef(model.fast, choice.model)),
    );

  return { model: choice.model, effort: choice.thinkingLevel, fast };
}

export function buildConfigPatch(
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

function readRunChoice(configuration: Configuration | null): RunChoice | null {
  return configuration === null
    ? null
    : { model: configuration.model, thinkingLevel: configuration.thinking };
}

function readCatalog(state: State): ModelCatalogView | null {
  return state.facts.catalog.catalog;
}

function sameRef(left: ModelRef, right: ModelRef): boolean {
  return left.provider === right.provider && left.id === right.id;
}

export function sameSelection(left: Selection, right: Selection): boolean {
  return (
    sameRef(left.model, right.model) && left.effort === right.effort && left.fast === right.fast
  );
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

export async function rememberThinking(level: Thinking, context: HandlerContext): Promise<void> {
  const { ports, read, dispatch } = context;

  if (read().facts.settings.thinkingLevel === level) return;
  const settings = await ports.settings.write(read().facts.workspace.cwd, { thinkingLevel: level });
  dispatch({ kind: "settings", settings });
}
