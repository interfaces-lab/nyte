/**
 * One-shot operations on the followed session: queue edits, stopping, answers,
 * moves, configuration, plugin commands and settings, tasks, directory
 * changes, reload and compaction. Each queue operation re-checks the latest
 * state right before the SDK call, so one aimed at a row that just landed
 * never becomes an edit that stops the run.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { MessageId, SessionId } from "@nyte-ai/sdk";
import type { Effect } from "../model/effect.ts";
import type { Notice, State } from "../model/state.ts";
import type { HandlerContext } from "./runner.ts";
import { fallback, patchOf, refreshWorkspace, selectionOf } from "./session.ts";

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
  const ok = await context.ports.host.session(effect.session).answer(effect.part, effect.choice);
  context.dispatch({ kind: "answered", part: effect.part, ok, typed: effect.typed });
}

export async function move(effect: Of<"move">, context: HandlerContext): Promise<void> {
  const outcome = await context.ports.host
    .session(effect.session)
    .move(effect.position, effect.options);

  context.dispatch({ kind: "moved", outcome, handback: effect.handback });
}

/** Through the configurator: a known selection changes at once and reaches the head in order before later sends. */
export async function configure(effect: Of<"configure">, context: HandlerContext): Promise<void> {
  const { read, scope } = context;
  const followed = scope.followed;

  if (followed === null || followed.id !== effect.session) return;
  const state = read();
  const current = selectionOf(state, effect.session) ?? fallback(state);
  const patch = patchOf(effect.selection, current, state.facts.catalog.catalog);

  if (patch.model === undefined && patch.thinkingLevel === undefined) return;
  const result = await followed.configurator.request(patch);

  if (result.kind === "failed") throw new Error(result.message);
}

/** A plugin setting: the head's settings for session scope, the host's for host scope. */
export async function applySetting(
  effect: Of<"apply-setting">,
  context: HandlerContext,
): Promise<void> {
  const { ports } = context;

  const outcome =
    effect.scope === "session"
      ? await ports.host.session(effect.session).applySetting(effect.id, effect.value)
      : await ports.host.applySetting(effect.id, effect.value);

  switch (outcome.kind) {
    case "applied":
    case "configured":
      return;
    case "invalid":
      throw new Error(
        outcome.issues.map((issue) => issue.message).join("; ") || `Invalid value for ${effect.id}`,
      );
    case "unknown":
      throw new Error(`Unknown setting: ${effect.id}`);
    case "unknown-model":
      throw new Error(`Unknown model: ${outcome.model.provider}/${outcome.model.id}`);
    case "unknown-agent":
      throw new Error(`Unknown agent: ${outcome.agent}`);
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

/** A core-side plugin command; what it prints comes back as a notice. */
export async function runCommand(
  effect: Of<"run-command">,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports } = context;
  const outcome = await ports.host.session(effect.session).command(effect.name, effect.argument);

  switch (outcome.kind) {
    case "ran":
      if (outcome.output !== null) dispatch({ kind: "inform", tone: "info", text: outcome.output });

      return;
    case "sent":
      return;
    case "invalid":
      throw new Error(
        outcome.issues.map((issue) => issue.message).join("; ") || "Invalid argument",
      );
    case "unknown":
      throw new Error(`Unknown command: /${effect.name}`);
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

/**
 * Moves the session to another folder: registers it as a workspace, as the
 * owner adding it is the consent, then relocates the idle session there.
 */
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
    finish(noticeOf(context, "info", `Already in ${path}`));

    return;
  }

  try {
    const port = ports.host.session(effect.session);
    const outcome = await port.changeDirectory(path);

    if (outcome.kind === "refused") {
      finish(noticeOf(context, "error", outcome.reason));

      return;
    }

    dispatch({ kind: "session-info", session: effect.session, info: await port.info() });
    await refreshWorkspace(context, outcome.cwd, { mentions: port, signal: context.signal });
    finish(noticeOf(context, "info", `Working directory: ${outcome.cwd}`));
  } catch (error) {
    finish(noticeOf(context, "error", error instanceof Error ? error.message : String(error)));
  }
}

/** Git facts for the footer after a run ends or the directory changes. */
export async function refreshWorkspaceFacts(
  effect: Of<"refresh-workspace">,
  context: HandlerContext,
): Promise<void> {
  await refreshWorkspace(context, effect.cwd);
}

/** Re-reads the workspace's project resources and this terminal's own settings. */
export async function reload(effect: Of<"reload">, context: HandlerContext): Promise<void> {
  const { dispatch, ports, read } = context;
  const session = read().facts.session;

  if (session === null) {
    dispatch({ kind: "op-finished", op: "reload", notice: null });

    return;
  }

  try {
    const outcome = await ports.host.session(session.id).reload();

    if (outcome === "missing") throw new Error("This chat's workspace is no longer registered.");
    const cwd = read().facts.workspace.cwd;
    const settings = await ports.settings.read(cwd);
    dispatch({ kind: "settings", settings });
    await refreshWorkspace(context, cwd);
    const skills = read().facts.session?.view?.catalog.skills.length ?? 0;

    dispatch({
      kind: "op-finished",
      op: "reload",
      notice: noticeOf(
        context,
        "info",
        `Reloaded this workspace's resources · ${String(skills)} ${skills === 1 ? "skill" : "skills"}`,
      ),
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

/** `~`, `~/x`, or a path relative to the session's folder. */
export function resolveDirectory(argument: string, cwd: string): string {
  if (argument === "~") return homedir();

  if (argument.startsWith("~/")) return resolve(homedir(), argument.slice(2));

  return resolve(cwd, argument);
}

export function noticeOf(context: HandlerContext, tone: Notice["tone"], text: string): Notice {
  return { tone, text, at: context.ports.clock.now() };
}

/** What the latest view says about a user message: still pending, landed, this client's unsent, or not there. */
export function rowStatus(
  state: State,
  session: SessionId,
  message: MessageId,
): "pending" | "landed" | "unsent" | "absent" {
  const followed = state.facts.session;

  if (followed === null || followed.id !== session || followed.view === null) return "absent";

  const row = followed.view.messages.find(
    (candidate) => candidate.kind === "user" && candidate.id === message,
  );

  if (row === undefined || row.kind !== "user") return "absent";

  return row.status.kind;
}
