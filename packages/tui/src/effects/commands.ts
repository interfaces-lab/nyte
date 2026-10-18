import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CommandOutcome, WorkspaceCommandOutcome, WorkspaceId } from "@nyte-ai/sdk";
import type { Effect } from "../model/effect.ts";
import { followedSession, rowStatus } from "../model/state.ts";
import type { Notice, Selection } from "../model/state.ts";
import { errorMessage } from "../lib/format.ts";
import { ignoredSettingsText } from "../services/settings.ts";
import type { HandlerContext, LocalHandlerContext } from "./scope.ts";
import {
  blankWorkspace,
  fallback,
  buildConfigPatch,
  openBlank,
  readSelection,
  refreshWorkspace,
  rememberThinking,
  toSelection,
} from "./session.ts";
import { startWithPrompt } from "./submit.ts";

type Of<K extends Effect["kind"]> = Extract<Effect, { readonly kind: K }>;

export async function withdraw(effect: Of<"withdraw">, context: HandlerContext): Promise<void> {
  const { dispatch, ports, read } = context;
  const status = rowStatus(read(), effect.session, effect.message);

  if (status !== "pending") {
    dispatch({
      kind: "withdrawn",
      message: effect.message,
      result: status === "landed" ? "landed-first" : "gone",
    });

    return;
  }

  const result = await ports.host.session(effect.session).withdraw(effect.message);
  dispatch({ kind: "withdrawn", message: effect.message, result });
}

export async function revise(effect: Of<"revise">, context: HandlerContext): Promise<void> {
  const { dispatch, ports, read } = context;
  const status = rowStatus(read(), effect.session, effect.message);

  if (status !== "pending") {
    dispatch({
      kind: "revised",
      message: effect.message,
      result: status === "landed" ? "landed-first" : "gone",
    });

    return;
  }

  const result = await ports.host.session(effect.session).revise(effect.message, effect.content, {
    replace: effect.message,
    delivery: effect.delivery,
    ...(effect.position === null ? {} : { position: effect.position }),
  });

  dispatch({ kind: "revised", message: effect.message, result });
}

export async function stopRun(effect: Of<"stop-run">, context: HandlerContext): Promise<void> {
  const result = await context.ports.host.session(effect.session).stopRun(effect.run);
  context.dispatch({ kind: "run-stopped", result });
}

export async function answer(effect: Of<"answer">, context: HandlerContext): Promise<void> {
  const request = { session: effect.session, part: effect.part };

  try {
    const ok = await context.ports.host.session(effect.session).answer(effect.part, effect.answers);
    context.dispatch({
      kind: "answered",
      request,
      result: { kind: ok ? "accepted" : "gone" },
      typed: effect.typed,
    });
  } catch (cause: unknown) {
    context.ports.log.write("effect", cause);
    context.dispatch({
      kind: "answered",
      request,
      result: { kind: "failed", message: errorMessage(cause) },
      typed: effect.typed,
    });
  }
}

export async function approve(effect: Of<"approve">, context: HandlerContext): Promise<void> {
  const outcome = await context.ports.host
    .session(effect.session)
    .approve(effect.part, effect.decision)
    .catch((cause: unknown) => {
      context.ports.log.write("effect", cause);

      return errorMessage(cause);
    });

  context.dispatch({ kind: "approved", part: effect.part, failure: outcome });
}

export async function move(effect: Of<"move">, context: HandlerContext): Promise<void> {
  const outcome = await context.ports.host
    .session(effect.session)
    .move(effect.position, effect.options);

  context.dispatch({ kind: "moved", outcome, handback: effect.handback });
}

export async function configure(effect: Of<"configure">, context: HandlerContext): Promise<void> {
  const { read, scope } = context;
  const followed = scope.followed;
  const { chat } = read().facts;

  if (chat?.kind === "blank" && chat.id === effect.session) {
    await configureBlank(effect, chat.selection, context);

    return;
  }

  if (followed === null || followed.id !== effect.session) return;
  const state = read();
  const current = readSelection(state, effect.session) ?? fallback(state);
  const patch = buildConfigPatch(effect.selection, current, state.facts.catalog.catalog);

  if (patch.model === undefined && patch.thinkingLevel === undefined) return;
  const result = await followed.configurator.request(patch);

  if (result.kind === "failed") throw new Error(result.message);
}

/** Settles a blank chat's model and thinking level and remembers them as the next chat's defaults; the first send starts the chat with them. */
async function configureBlank(
  effect: Of<"configure">,
  current: Selection,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, read } = context;
  const catalog = read().facts.catalog.catalog;
  const patch = buildConfigPatch(effect.selection, current, catalog);
  const model = patch.model ?? current.model;
  const effort = patch.thinkingLevel ?? current.effort;

  const selection = toSelection({ model, thinkingLevel: effort }, catalog);
  dispatch({ kind: "selection", session: effect.session, selection });
  await ports.firstFrame.write(selection).catch((error: unknown) => {
    ports.log.write("effect", error);
  });

  if (patch.model !== undefined)
    await ports.host.setDefaultModel(patch.model).catch((error: unknown) => {
      ports.log.write("effect", error);
    });

  if (patch.thinkingLevel !== undefined)
    await rememberThinking(patch.thinkingLevel, context).catch((error: unknown) => {
      ports.log.write("effect", error);
    });
}

export async function checkTrust(
  effect: Of<"check-trust">,
  context: HandlerContext,
): Promise<void> {
  const found = await context.ports.host.trustInfo(effect.workspace).catch((error: unknown) => {
    if (effect.ask === "always") throw error;
    context.ports.log.write("trust", error);
    context.dispatch({ kind: "trust-settled", workspace: effect.workspace });

    return null;
  });

  if (found === null) return;
  context.dispatch({
    kind: "trust-loaded",
    workspace: effect.workspace,
    ask: effect.ask,
    ...found,
  });
}

export async function setTrust(effect: Of<"set-trust">, context: HandlerContext): Promise<void> {
  try {
    await context.ports.host.trust(effect.workspace, effect.value);
  } finally {
    context.dispatch({ kind: "trust-settled", workspace: effect.workspace });
  }

  const { chat } = context.read().facts;

  if (
    chat?.kind === "blank" &&
    chat.folder.kind === "folder" &&
    chat.folder.id === effect.workspace
  )
    await loadFolderCatalog(effect.workspace, context);
}

/** Reads the plugin commands and skills a new chat in `workspace` would offer, for the blank chat there. */
export async function loadFolderCatalog(
  workspace: WorkspaceId,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, scope } = context;
  const generation = (scope.folderCatalogGeneration += 1);
  const catalog = await ports.host.workspace(workspace).catalog();
  dispatch({ kind: "folder-catalog", generation, workspace, catalog });
}

export async function applySetting(
  effect: Of<"apply-setting">,
  context: HandlerContext,
): Promise<void> {
  const { ports } = context;

  const outcome =
    effect.scope === "session"
      ? await ports.host.session(effect.session).applySetting(effect.id, effect.value)
      : await ports.host.applySetting(effect.id, effect.value);

  if (outcome.kind !== "applied" && outcome.kind !== "configured")
    throw new Error(`Could not set ${effect.label}`);
}

/** Runs a plugin command in the followed chat, or in a blank chat's folder, where a command answering with a prompt starts the chat with it. */
export async function runCommand(
  effect: Of<"run-command">,
  context: HandlerContext,
): Promise<void> {
  const { ports, read } = context;
  const { chat } = read().facts;

  if (chat?.kind !== "blank" || chat.id !== effect.session) {
    settleCommand(
      await ports.host.session(effect.session).command(effect.name, effect.argument),
      effect,
      context,
    );

    return;
  }

  const workspace = await blankWorkspace(chat, context);
  const outcome = await ports.host.workspace(workspace).command(effect.name, effect.argument);

  if (outcome.kind === "prompt") await startWithPrompt(chat, workspace, outcome.content, context);
  else settleCommand(outcome, effect, context);
}

/** Asks the followed chat, or a blank chat's folder, what may follow a command's name, for the menu still showing that text. */
export async function completeCommand(
  effect: Of<"complete-command">,
  context: HandlerContext,
): Promise<void> {
  const { ports, read, dispatch } = context;
  const { chat } = read().facts;

  const items =
    chat?.kind === "blank" && chat.id === effect.session
      ? await ports.host
          .workspace(await blankWorkspace(chat, context))
          .completeCommand(effect.name, effect.prefix)
      : await ports.host.session(effect.session).completeCommand(effect.name, effect.prefix);

  dispatch({ kind: "command-completed", name: effect.name, prefix: effect.prefix, items });
}

function settleCommand(
  outcome: Exclude<CommandOutcome | WorkspaceCommandOutcome, { readonly kind: "prompt" }>,
  effect: Of<"run-command">,
  { dispatch }: HandlerContext,
): void {
  switch (outcome.kind) {
    case "ran":
      if (outcome.output !== null) dispatch({ kind: "inform", tone: "info", text: outcome.output });

      return;
    case "sent":
      return;
    case "unknown":
      dispatch({
        kind: "command-unknown",
        session: effect.session,
        name: effect.name,
        argument: effect.argument,
        delivery: effect.delivery,
      });

      return;
    case "failed":
      throw new Error(outcome.message);
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

export async function stopTask(effect: Of<"stop-task">, context: HandlerContext): Promise<void> {
  const result = await context.ports.host.session(effect.session).stopTask(effect.task);

  if (result === "missing")
    context.dispatch({ kind: "inform", tone: "warning", text: "That task already ended." });
}

export async function changeDirectory(
  effect: Of<"change-directory">,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, read } = context;
  const cwd = read().facts.workspace.cwd;
  const path = resolveDirectory(effect.path, cwd);

  const finish = (notice: Notice): void => {
    dispatch({ kind: "op-finished", op: "cd", notice });
  };

  if (path === cwd) {
    finish(stampNotice(context, "info", `Already in ${path}`));

    return;
  }

  try {
    const { chat } = read().facts;

    if (chat?.kind === "blank" && chat.id === effect.session) {
      await openBlank(
        { ...chat, folder: { kind: "folder", id: await ports.host.openFolder(path) } },
        context,
      );
      finish(stampNotice(context, "ok", `Working directory: ${path}`));

      return;
    }

    const port = ports.host.session(effect.session);
    const outcome = await port.changeDirectory(path);

    if (outcome.kind === "refused") {
      finish(stampNotice(context, "error", `error: ${outcome.reason}`));

      return;
    }

    dispatch({ kind: "session-info", session: effect.session, info: await port.info() });
    await refreshWorkspace(context, outcome.cwd, { mentions: port, signal: context.signal });
    finish(stampNotice(context, "ok", `Working directory: ${outcome.cwd}`));
  } catch (error) {
    finish(errorNotice(context, error));
  }
}

export async function refreshWorkspaceFacts(
  effect: Of<"refresh-workspace">,
  context: LocalHandlerContext,
): Promise<void> {
  await refreshWorkspace(context, effect.cwd);
}

export async function reload(effect: Of<"reload">, context: HandlerContext): Promise<void> {
  const { dispatch, ports, read } = context;
  const session = followedSession(read());

  if (session === null) {
    dispatch({ kind: "op-finished", op: "reload", notice: null });

    return;
  }

  try {
    const outcome = await ports.host.session(session.id).reload();

    if (outcome === "missing") throw new Error("This chat's workspace is no longer registered.");
    const cwd = read().facts.workspace.cwd;
    await ports.settings.settled();
    const { settings, invalid } = ports.settings.read(cwd);
    dispatch({ kind: "settings", settings });
    await refreshWorkspace(context, cwd);
    const skills = followedSession(read())?.view?.catalog.skills.length ?? 0;
    const reloaded = `Reloaded this workspace's resources · ${String(skills)} ${skills === 1 ? "skill" : "skills"}`;

    dispatch({
      kind: "op-finished",
      op: "reload",
      notice:
        invalid.length === 0
          ? stampNotice(context, "ok", reloaded)
          : stampNotice(context, "warning", `${reloaded}\n${ignoredSettingsText(invalid)}`),
    });
  } catch (error) {
    dispatch({ kind: "op-finished", op: "reload", notice: null });
    throw error;
  }
}

export async function compact(effect: Of<"compact">, context: HandlerContext): Promise<void> {
  const outcome = await context.ports.host.session(effect.session).compact(effect.instructions);

  if (outcome === "busy") throw new Error("Wait for the current run before compacting");

  if (outcome === "nothing")
    context.dispatch({ kind: "inform", tone: "info", text: "Nothing to compact" });
}

function resolveDirectory(argument: string, cwd: string): string {
  if (argument === "~") return homedir();

  if (argument.startsWith("~/")) return resolve(homedir(), argument.slice(2));

  return resolve(cwd, argument);
}

export function stampNotice(context: HandlerContext, tone: Notice["tone"], text: string): Notice {
  return { tone, text, at: context.ports.clock.now() };
}

export function errorNotice(context: HandlerContext, error: unknown): Notice {
  return stampNotice(context, "error", `error: ${errorMessage(error)}`);
}
