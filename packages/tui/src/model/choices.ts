/**
 * The rows of list dialogs whose content is derived from facts (palette,
 * skills, queue, settings, a setting's choices, tasks, providers). They are
 * recomputed whenever the screen is, so a task that finishes or a message
 * that lands updates the open list instead of leaving a stale row behind.
 */
import type { SessionInfo } from "@nyte-ai/sdk";
import { CHAT_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand } from "../lib/constants.ts";
import { formatDuration, shortId } from "../lib/format.ts";
import {
  statusMark,
  taskActivity,
  taskAgent,
  taskConfiguration,
  taskElapsedMs,
  taskLabel,
  taskStatus,
  unfinishedTask,
} from "../lib/tasks.ts";
import { commandRegistry, skillsOf } from "./commands.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import type { Choice, ListDialog, ListPurpose } from "./dialogs/list.ts";
import { visibleChoices } from "./dialogs/list.ts";
import { chatCommands, COMMAND_TITLES, interactionsFor } from "./interactions.ts";
import { placeLabel, queueRows } from "./queue.ts";
import { tableInputFor } from "./screen.ts";
import { settingRows, settingValue } from "./settings.ts";
import type { State } from "./state.ts";

function choice(
  id: string,
  label: string,
  description = "",
  extra: Partial<Pick<Choice, "status" | "mark">> = {},
): Choice {
  return { id, label, description, status: extra.status ?? null, mark: extra.mark ?? null };
}

const KEY_NAMES = new Map([
  ["escape", "esc"],
  ["return", "enter"],
  ["kpenter", "enter"],
]);

/** Every key a command is bound to, the way help prints them: `enter`, `esc`, `ctrl+enter/ctrl+enter`, de-duplicated. */
export function bindingKeycaps(command: ChatCommand): string {
  const caps = CHAT_KEYBINDS[command]
    .split(",")
    .map((binding) => binding.replace(/[^+]+$/u, (name) => KEY_NAMES.get(name) ?? name));

  return [...new Set(caps)].join("/");
}

/** The chat commands that do something now, as help lists them (hidden ones included). */
function activeCommands(
  state: State,
): readonly { readonly command: ChatCommand; readonly label: string }[] {
  const interactions = interactionsFor(tableInputFor(state, null));

  return chatCommands().flatMap((command) => {
    const interaction = interactions[command];

    return interaction.intent === null || COMMAND_TITLES[command] === undefined
      ? []
      : [{ command, label: interaction.label }];
  });
}

/** The "Keyboard shortcuts" report: every active binding, including those hidden at this width. */
export function shortcutLines(state: State): readonly string[] {
  return activeCommands(state).map(({ command, label }) => `${bindingKeycaps(command)} ${label}`);
}

function taskChoices(state: State, section: "active" | "finished", now: number): readonly Choice[] {
  const { tasks } = state.facts;
  const finished = section === "finished";

  return [
    ...tasks
      .filter((task) => unfinishedTask(task) !== finished)
      .map((task) => {
        const mark = statusMark(taskStatus(task));
        const elapsed = taskElapsedMs(task, now);

        return choice(
          task.id,
          `${taskAgent(task)} · ${taskLabel(task)}`,
          [
            elapsed === undefined ? undefined : formatDuration(Math.max(0, elapsed)),
            task.kind === "agent" ? taskConfiguration(task) : undefined,
          ]
            .filter((value) => value !== undefined && value !== "")
            .join(" · "),
          { mark, status: { text: taskActivity(task), tone: "muted" } },
        );
      }),
    finished
      ? choice("section:active", "Back to Tasks")
      : choice(
          "section:finished",
          `Finished · ${String(tasks.filter((task) => !unfinishedTask(task)).length)}`,
        ),
  ];
}

/** Rows for a purpose derived from facts; null for purposes whose rows were loaded or fixed at open. */
export function liveChoices(state: State, purpose: ListPurpose, now = 0): readonly Choice[] | null {
  switch (purpose.kind) {
    case "palette":
      return [
        choice(
          "shortcuts",
          "Keyboard shortcuts",
          "All active bindings, including those hidden at this width",
        ),
        ...commandRegistry(state)
          .filter((entry) => !entry.prompt)
          .map((entry) => choice(`cmd:${entry.name}`, `/${entry.name}`, entry.description)),
        ...activeCommands(state).map(({ command, label }) =>
          choice(
            `action:${command}`,
            `${bindingKeycaps(command)} ${label}`,
            COMMAND_TITLES[command] ?? "",
          ),
        ),
      ];
    case "skills":
      return [...skillsOf(state).values()]
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((skill) => choice(skill.name, skill.name, skill.description));
    case "queue":
      return queueRows(state.facts.session, state.local.editing).map((row, index) =>
        choice(row.id, row.text, `${String(index + 1)} · ${placeLabel(row.place)}`),
      );
    case "settings":
      return settingRows(state).map((row) => choice(row.id, row.label, settingValue(row)));
    case "setting":
      return (settingRows(state).find((row) => row.id === purpose.key)?.choices ?? []).map(
        (option) => choice(option.id, option.label, option.description),
      );
    case "tasks":
      return taskChoices(state, purpose.section, now);
    case "provider":
      return (state.facts.catalog.catalog?.providers ?? [])
        .filter((provider) =>
          purpose.mode === "login"
            ? provider.methods.length > 0
            : provider.credential === "configured" || provider.credential === "verified",
        )
        .map((provider) =>
          choice(
            provider.id,
            provider.name,
            purpose.mode === "login" &&
              (provider.credential === "configured" || provider.credential === "verified")
              ? "signed in"
              : "",
          ),
        );
    case "question":
    case "resume":
    case "summary":
      return null;
    default: {
      const _exhaustive: never = purpose;

      return _exhaustive;
    }
  }
}

export function listTitle(state: State, purpose: ListPurpose): string {
  switch (purpose.kind) {
    case "question":
      return "Question";
    case "resume":
      return "Resume chat";
    case "palette":
      return "Commands";
    case "skills":
      return "Skills";
    case "queue":
      return "Queued messages";
    case "settings":
      return "Settings";
    case "setting":
      return settingRows(state).find((row) => row.id === purpose.key)?.label ?? purpose.key;
    case "summary":
      return "Summarize the branch you are leaving?";
    case "tasks":
      return purpose.section === "finished" ? "Tasks · Finished" : "Tasks";
    case "provider":
      return purpose.mode === "login" ? "Sign in to a provider" : "Remove a stored credential";
    default: {
      const _exhaustive: never = purpose;

      return _exhaustive;
    }
  }
}

/** The row a list opens on: the queued message, the settings row, the current choice, else the first. */
export function initialHighlight(
  state: State,
  purpose: ListPurpose,
  items: readonly Choice[],
): number {
  const index = (id: string | null | undefined): number =>
    id === null || id === undefined
      ? 0
      : Math.max(
          0,
          items.findIndex((item) => item.id === id),
        );

  switch (purpose.kind) {
    case "queue":
      return index(purpose.message);
    case "settings":
      return index(purpose.highlight ?? "model");
    case "setting":
      return index(settingRows(state).find((row) => row.id === purpose.key)?.current);
    case "resume":
      return index(state.facts.session?.id);
    case "provider":
      return index(state.facts.session?.selection.model.provider);
    default:
      return 0;
  }
}

/** Root sessions whose head moved, newest first, the current one marked. */
export function resumeChoices(state: State, sessions: readonly SessionInfo[]): readonly Choice[] {
  const current = state.facts.session?.id ?? null;

  return sessions
    .filter((session) => session.heads.some((head) => head.tip.kind !== "start"))
    .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
    .map((session) =>
      choice(
        session.id,
        `${session.name ?? shortId(session.id)}${session.id === current ? " (current)" : ""}`,
        `${new Date(session.lastActivityAt).toLocaleString()} · ${shortId(session.id)}`,
      ),
    );
}

/** A list dialog with its derived rows refreshed and its highlight kept in range. */
export function liveList(state: State, dialog: ListDialog, now = 0): ListDialog {
  const items = liveChoices(state, dialog.purpose, now);

  if (items === null) return dialog;

  const next: ListDialog = {
    ...dialog,
    title: listTitle(state, dialog.purpose),
    choices: { kind: "ready", items },
  };

  const count = visibleChoices(next).length + (next.answering === null ? 0 : 1);

  return {
    ...next,
    highlighted: Math.max(0, Math.min(Math.max(0, count - 1), dialog.highlighted)),
  };
}

export function liveDialog(state: State, dialog: Dialog): Dialog {
  return dialog.kind === "list" ? liveList(state, dialog) : dialog;
}
