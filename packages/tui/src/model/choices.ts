import type { SessionInfo } from "@nyte-ai/sdk";
import { CHAT_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand } from "../lib/constants.ts";
import { shortId } from "../lib/format.ts";
import {
  statusMark,
  taskActivity,
  taskAgent,
  taskConfiguration,
  taskLabel,
  taskStatus,
  taskTiming,
  unfinishedTask,
} from "../lib/tasks.ts";
import { commandRegistry, indexSkills } from "./commands.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import type { Choice, ListDialog, ListPurpose } from "./dialogs/list.ts";
import { visibleChoices } from "./dialogs/list.ts";
import { chatCommands, COMMAND_TITLES, interactionsFor } from "./interactions.ts";
import { placeLabel, queueRows } from "./queue.ts";
import { tableInputFor } from "./table-input.ts";
import { settingRows, settingValue } from "./settings.ts";
import { followedSession } from "./state.ts";
import type { State } from "./state.ts";

function choice(
  id: string,
  label: string,
  description = "",
  extra: Partial<Pick<Choice, "timing" | "status" | "mark">> = {},
): Choice {
  return {
    id,
    label,
    description,
    timing: extra.timing ?? null,
    status: extra.status ?? null,
    mark: extra.mark ?? null,
  };
}

const KEY_NAMES = new Map([
  ["escape", "esc"],
  ["return", "enter"],
  ["kpenter", "enter"],
]);

function bindingKeycaps(command: ChatCommand): string {
  const caps = CHAT_KEYBINDS[command]
    .split(",")
    .map((binding) => binding.replace(/[^+]+$/u, (name) => KEY_NAMES.get(name) ?? name));

  return [...new Set(caps)].join("/");
}

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

export function shortcutLines(state: State): readonly string[] {
  return activeCommands(state).map(({ command, label }) => `${bindingKeycaps(command)} ${label}`);
}

function taskChoices(state: State, section: "active" | "finished"): readonly Choice[] {
  const { tasks } = state.facts;
  const finished = section === "finished";

  return [
    ...tasks
      .filter((task) => unfinishedTask(task) !== finished)
      .map((task) => {
        return choice(
          task.id,
          `${taskAgent(task)} · ${taskLabel(task)}`,
          task.kind === "agent" ? taskConfiguration(task) : "",
          {
            timing: taskTiming(task),
            mark: statusMark(taskStatus(task)),
            status: { text: taskActivity(task), tone: "muted" },
          },
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

export function liveChoices(state: State, purpose: ListPurpose): readonly Choice[] | null {
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
      return [...indexSkills(state).values()]
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((skill) => choice(skill.name, skill.name, skill.description));
    case "queue":
      return queueRows(followedSession(state), state.local.editing).map((row, index) =>
        choice(row.id, row.text, `${String(index + 1)} · ${placeLabel(row.place)}`),
      );
    case "settings":
      return settingRows(state).map((row) => choice(row.id, row.label, settingValue(row)));
    case "setting":
      return (settingRows(state).find((row) => row.id === purpose.key)?.choices ?? []).map(
        (option) => choice(option.id, option.label, option.description),
      );
    case "tasks":
      return taskChoices(state, purpose.section);
    case "provider":
      return (state.facts.catalog.catalog?.providers ?? [])
        .filter((provider) =>
          purpose.mode === "login"
            ? provider.methods.length > 0
            : provider.credential !== "missing" && provider.credential !== "unknown",
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
    case "mcp":
    case "mcp-server":
      return null;
    case "trust": {
      const shown = purpose.sources.slice(0, 3).join(", ");
      const more =
        purpose.sources.length > 3 ? ` and ${String(purpose.sources.length - 3)} more` : "";

      return [
        choice(
          "trust",
          "Trust this folder",
          shown === "" ? "Load its project files" : `Load ${shown}${more}`,
        ),
        choice("decline", "Don't trust", "Skip its skills, prompts, plugins and MCP servers"),
        ...(purpose.decision === null
          ? []
          : [choice("forget", "Forget my answer", "Follow the Project trust setting")]),
      ];
    }
    case "question":
    case "accounts":
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
    case "accounts":
      return "Accounts";
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
    case "trust":
      return `Trust ${purpose.path}?`;
    case "mcp":
      return "MCP servers";
    case "mcp-server":
      return purpose.server;
    default: {
      const _exhaustive: never = purpose;

      return _exhaustive;
    }
  }
}

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
      return index(state.facts.chat?.id);
    case "provider":
      return index(state.facts.chat?.selection.model.provider);
    case "trust":
      return index(purpose.decision === false ? "decline" : "trust");
    default:
      return 0;
  }
}

export function resumeChoices(state: State, sessions: readonly SessionInfo[]): readonly Choice[] {
  const current = state.facts.chat?.id ?? null;

  return sessions
    .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
    .map((session) =>
      choice(
        session.id,
        `${session.name ?? shortId(session.id)}${session.id === current ? " (current)" : ""}`,
        `${new Date(session.lastActivityAt).toLocaleString()} · ${shortId(session.id)}`,
      ),
    );
}

function liveList(state: State, dialog: ListDialog): ListDialog {
  const items = liveChoices(state, dialog.purpose);

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
