import { commandBindings, formatCommandBindings } from "@opentui/keymap/extras";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { CHAT_KEYBINDS } from "./constants.ts";
import { openDiagnosticReport } from "./diagnostic-report.ts";
import type { LaneRoles } from "./lanes.ts";
import { notice, selectChoice } from "./app/ui.ts";
import type { Shell } from "./app/ui.ts";
import { slashCommandLabel } from "./slash.ts";
import type { SlashCommand } from "./slash.ts";
import { displayWidth } from "./width.ts";

export type ComposerOperation =
  | { readonly kind: "submit" | "save-edit"; readonly lane: string }
  | { readonly kind: "cancel-edit" | "stop" | "tree" | "clear" | "quit" };

export interface ComposerActionState {
  readonly busy: boolean;
  /** One of the user's `!` commands is running; Esc stops it, nothing else changes. */
  readonly shell: boolean;
  readonly shellInput: "include" | "exclude" | undefined;
  readonly waiting: boolean;
  readonly question: boolean;
  readonly draft: "empty" | "blank" | "message";
  readonly editingLane: string | undefined;
  readonly followUp: "steer" | "queue";
  readonly blocked: string | undefined;
  readonly completion: { readonly accepting: boolean; readonly queueable: boolean } | undefined;
}

export type ComposerActionName =
  | "chat.submit"
  | "chat.queue.submit"
  | "chat.interrupt"
  | "chat.quit";

const ACTION_NAMES = [
  "chat.submit",
  "chat.queue.submit",
  "chat.interrupt",
  "chat.quit",
] as const satisfies readonly ComposerActionName[];

export interface ComposerAction {
  readonly label: string;
  readonly reason: string | undefined;
  readonly operation: ComposerOperation;
}

/** Every composer action for one state, so a key, a hint row, and help agree. */
export interface ComposerActionSet {
  readonly primaryLane: string;
  readonly actions: Readonly<Record<ComposerActionName, ComposerAction>>;
}

export function sameActionState(left: ComposerActionState, right: ComposerActionState): boolean {
  return (
    left.busy === right.busy &&
    left.shell === right.shell &&
    left.shellInput === right.shellInput &&
    left.waiting === right.waiting &&
    left.question === right.question &&
    left.draft === right.draft &&
    left.editingLane === right.editingLane &&
    left.followUp === right.followUp &&
    left.blocked === right.blocked &&
    left.completion?.accepting === right.completion?.accepting &&
    left.completion?.queueable === right.completion?.queueable
  );
}

function completionReason(
  state: ComposerActionState,
  name: ComposerActionName,
): string | undefined {
  if (state.blocked !== undefined) return state.blocked;
  if (state.completion === undefined || name === "chat.quit") return undefined;
  if (name === "chat.interrupt") return "Completion owns the composer";
  return state.completion.accepting && (name !== "chat.queue.submit" || !state.completion.queueable)
    ? "Completion owns the composer"
    : undefined;
}

/** Pure: reads nothing but its arguments, so it runs once per state, not once per getter. */
export function projectComposerActions(
  state: ComposerActionState,
  roles: LaneRoles,
): ComposerActionSet {
  const primaryLane =
    state.editingLane ?? (state.busy && !state.waiting ? roles[state.followUp] : roles.steer);
  const submission = state.editingLane === undefined ? "submit" : "save-edit";
  const alternate =
    state.editingLane !== undefined || (state.busy && !state.waiting && state.followUp === "queue")
      ? roles.steer
      : roles.queue;
  const interrupt: ComposerAction =
    state.editingLane !== undefined
      ? {
          label: "cancel edit",
          reason: completionReason(state, "chat.interrupt"),
          operation: { kind: "cancel-edit" },
        }
      : state.busy || state.shell
        ? {
            label: "stop",
            reason: completionReason(state, "chat.interrupt"),
            operation: { kind: "stop" },
          }
        : {
            label: "tree (twice)",
            reason:
              completionReason(state, "chat.interrupt") ??
              (state.draft === "message" ? "Clear the draft before opening the tree" : undefined),
            operation: { kind: "tree" },
          };
  return {
    primaryLane,
    actions: {
      "chat.submit": {
        label:
          state.editingLane !== undefined
            ? "save"
            : state.shellInput !== undefined
              ? state.shellInput === "include"
                ? "run locally"
                : "run privately"
              : state.question
                ? "answer"
                : state.busy
                  ? primaryLane
                  : "send",
        reason: completionReason(state, "chat.submit"),
        operation: { kind: submission, lane: primaryLane },
      },
      "chat.queue.submit": {
        label: alternate,
        reason:
          completionReason(state, "chat.queue.submit") ??
          (state.draft === "message" ? undefined : "Enter a message first"),
        operation: { kind: submission, lane: alternate },
      },
      "chat.interrupt": interrupt,
      "chat.quit": {
        label: state.draft !== "empty" ? "clear draft" : "quit",
        reason: completionReason(state, "chat.quit"),
        operation: { kind: state.draft !== "empty" ? "clear" : "quit" },
      },
    },
  };
}

/**
 * Delivery and cancellation resolve together, before either a key or help
 * invokes them. The projection is recomputed only when the state changes, so
 * the keymap's enabled checks and metadata getters share one result.
 */
export class ComposerActions {
  private readonly read: () => ComposerActionState;
  private readonly roles: LaneRoles;
  private readonly disposeLayer: () => void;
  private last:
    | { readonly state: ComposerActionState; readonly set: ComposerActionSet }
    | undefined;

  constructor(
    shell: Shell,
    roles: LaneRoles,
    read: () => ComposerActionState,
    invoke: (operation: ComposerOperation) => void,
  ) {
    this.read = read;
    this.roles = roles;
    const action = (name: ComposerActionName): ComposerAction => this.current().actions[name];
    this.disposeLayer = shell.keymap.registerLayer({
      priority: 1,
      commands: ACTION_NAMES.map((name) => ({
        name,
        namespace: "composer",
        get title() {
          return action(name).label;
        },
        get hint() {
          return action(name).label;
        },
        get unavailable() {
          return action(name).reason;
        },
        get placement() {
          if (name === "chat.submit") return "primary";
          if (name === "chat.interrupt") return "cancel";
          if (name === "chat.quit" && action("chat.interrupt").reason !== undefined)
            return "cancel";
          return "secondary";
        },
        enabled: () => action(name).reason === undefined,
        run: () => {
          const resolved = action(name);
          if (resolved.reason !== undefined) return false;
          invoke(resolved.operation);
          return true;
        },
      })),
      bindings: commandBindings(
        Object.fromEntries(ACTION_NAMES.map((name) => [name, CHAT_KEYBINDS[name]])),
      ),
    });
  }

  /** The projection for the state as read now. */
  current(): ComposerActionSet {
    const state = this.read();
    if (this.last !== undefined && sameActionState(this.last.state, state)) return this.last.set;
    const set = projectComposerActions(state, this.roles);
    this.last = { state, set };
    return set;
  }

  get primaryLane(): string {
    return this.current().primaryLane;
  }

  dispose(): void {
    this.disposeLayer();
  }
}

/** The registered bindings are the only source of displayed keycaps. */
export function actionEntries(shell: Shell) {
  const entries = shell.keymap.getCommandEntries({
    visibility: "active",
    namespace: ["composer", "completion", "chat", "selection"],
  });
  const bindings = shell.keymap.getCommandBindings({
    visibility: "active",
    commands: entries.map(({ command }) => command.name),
  });
  return entries.map(({ command }) => ({
    command,
    keycaps:
      formatCommandBindings(bindings.get(command.name), {
        keyNameAliases: { escape: "esc", return: "enter", kpenter: "enter" },
        bindingSeparator: "/",
      }) ?? "",
  }));
}

/** Help captures the invoking state before a menu temporarily takes keyboard ownership. */
export async function openActionPalette(
  shell: Shell,
  commands: readonly SlashCommand[],
  restore: () => void,
  onReportClose: () => void,
): Promise<string | undefined> {
  const actions = actionEntries(shell);
  const shortcuts = actions.map(
    ({ command, keycaps }) => `${keycaps} ${String(command.hint ?? command.title)}`,
  );
  const selected = await selectChoice(shell, "Commands", [
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      description: "All active bindings, including those hidden at this width",
    },
    ...commands.map((command) => ({
      id: command.name,
      label: slashCommandLabel(command),
      description: command.description,
    })),
    ...actions.map(({ command, keycaps }) => ({
      id: `action:${command.name}`,
      label: `${keycaps} ${String(command.hint ?? command.title)}`,
      description: String(command.title),
    })),
  ]).finally(restore);
  if (selected === "shortcuts") {
    openDiagnosticReport(shell, "Keyboard shortcuts", shortcuts, onReportClose);
    return undefined;
  }
  if (selected.startsWith("action:")) {
    const result = shell.keymap.dispatchCommand(selected.slice("action:".length), {
      includeCommand: true,
    });
    if (!result.ok) {
      const reason = "command" in result ? result.command?.unavailable : undefined;
      notice(
        shell,
        Value.Check(Type.String(), reason) ? reason : "That shortcut is no longer available.",
      );
    }
    return undefined;
  }
  return selected;
}

/** Primary, cancel, and discovery stay visible; other active bindings fit or live in help. */
export function composerHints(shell: Shell): string {
  // Wrapping different controls during a drag moves the text under the pointer.
  if (shell.renderer.getSelection()?.isDragging) return shell.ui.hints;
  const entries = actionEntries(shell);
  const required = entries.filter(({ command }) =>
    ["primary", "cancel", "help"].includes(String(command.placement)),
  );
  const secondary = entries.filter(({ command }) => command.placement === "secondary");
  const hints = required.map(actionLabel);
  for (const entry of secondary) {
    const next = actionLabel(entry);
    if (displayWidth([...hints, next].join(" · ")) <= shell.renderer.width - 6) hints.push(next);
  }
  return hints.join(" · ");
}

function actionLabel(entry: ReturnType<typeof actionEntries>[number]): string {
  return `${entry.keycaps} ${String(entry.command.hint ?? entry.command.title)}`;
}
