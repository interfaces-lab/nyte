import type { Delivery } from "@nyte-ai/sdk";
import { CHAT_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand } from "../lib/constants.ts";
import type { CompletionModel } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import { listActions } from "./dialogs/list.ts";
import type { DraftModel } from "./draft.ts";
import type { Intent } from "./msg.ts";
import type { QueueRow } from "./queue.ts";
import type { QuestionModel } from "./question.ts";
import type { Blocked, EditingModel, RunModel } from "./screen.ts";
import type { Draft, ShellJob } from "./state.ts";

export type CoreCommand = "chat.submit" | "chat.queue.submit" | "chat.interrupt" | "chat.quit";

export interface Interaction {
  readonly intent: Intent | null;
  readonly label: string;
  readonly hidden: boolean;
}

export type Interactions = Readonly<Record<ChatCommand, Interaction>>;

export interface TableInput {
  readonly run: RunModel;
  readonly question: QuestionModel | null;
  readonly draft: DraftModel;
  readonly runsCommand: boolean;
  readonly editing: EditingModel | null;
  readonly shell: ShellJob | null;
  readonly completion: CompletionModel | null;
  readonly dialog: Dialog | null;
  readonly blocked: Blocked | null;
  readonly queue: readonly QueueRow[];
  readonly followUp: "steer" | "queue";
  readonly tasks: number;
  readonly now: number;
  readonly cursor: {
    readonly row: Draft["row"];
    readonly atStart: boolean;
    readonly atEnd: boolean;
  };
  readonly browsing: boolean;
}

type Cell = (input: TableInput) => Interaction | null;

const pass: Cell = () => null;

interface Row {
  readonly name: string;
  readonly active: (input: TableInput) => boolean;
  readonly cells: Readonly<Record<CoreCommand, Cell>>;
}

const OFF: Interaction = { intent: null, label: "", hidden: true };

const CORE_COMMANDS: readonly CoreCommand[] = [
  "chat.submit",
  "chat.queue.submit",
  "chat.interrupt",
  "chat.quit",
];

export const COMMAND_TITLES: Readonly<Partial<Record<ChatCommand, string>>> = {
  "chat.submit": "Send the draft",
  "chat.queue.submit": "Send with the other delivery",
  "chat.interrupt": "Stop, cancel or go back",
  "chat.quit": "Clear the draft, or quit",
  "chat.scroll.page.up": "Scroll the transcript up",
  "chat.scroll.page.down": "Scroll the transcript down",
  "chat.scroll.latest": "Jump to latest",
  "chat.message.previous": "Previous message",
  "chat.message.next": "Next message",
  "chat.thinking.cycle": "Cycle the thinking level",
  "chat.model.next": "Next model",
  "chat.model.previous": "Previous model",
  "chat.editor.open": "Edit the draft in your editor",
  "chat.attachment.open": "Expand or preview the attachment at the cursor",
  "chat.clipboard.paste": "Paste text or an image from the clipboard",
  "chat.queue.open": "Edit or remove queued messages",
  "chat.tools.toggle": "Expand or collapse tool output and thoughts",
  "chat.skills.open": "Run a skill",
  "chat.commands.open": "Commands and active shortcuts",
  "chat.history.previous": "Previous message you sent at the start of the draft",
  "chat.history.next": "Next message you sent at the end of the draft",
};

function on(intent: Intent, label: string, hidden = false): Interaction {
  return { intent, label, hidden };
}

function isMessage(
  input: TableInput,
): input is TableInput & { readonly draft: Extract<DraftModel, { kind: "message" }> } {
  return input.draft.kind === "message";
}

export function busyDelivery(followUp: "steer" | "queue", alternate: boolean): Delivery {
  if (!alternate) return followUp;

  return followUp === "steer" ? "queue" : "steer";
}

export function promotable(queue: readonly QueueRow[]): QueueRow | null {
  return (
    queue.find(
      (row) => row.withdrawable && row.place.kind !== "joining" && row.place.kind !== "uncovered",
    ) ?? null
  );
}

export function blockedReason(blocked: Blocked): string {
  switch (blocked.kind) {
    case "starting":
      return "Still starting. Your draft is saved here.";
    case "no-session":
      return "Loading session. Your draft is saved here.";
    case "switching":
    case "changing-directory":
      return "Switching workspace. Your draft is saved here.";
    case "authenticating":
      return "Finish signing in or out first. Esc cancels.";
    case "editor":
      return "Finish editing in your editor";
    default: {
      const _exhaustive: never = blocked;

      return _exhaustive;
    }
  }
}

function alternateDelivery(input: TableInput): Delivery {
  return input.run.kind === "idle" ? "queue" : busyDelivery(input.followUp, true);
}

function refuseBlocked(input: TableInput): Interaction | null {
  return input.blocked === null
    ? null
    : on({ kind: "refuse", reason: blockedReason(input.blocked) }, "send", true);
}

function cancelAuthentication(input: TableInput): Interaction | null {
  return input.blocked?.kind === "authenticating"
    ? on({ kind: "cancel-auth" }, "cancel authentication")
    : null;
}

function acceptCompletion(input: TableInput): Interaction | null {
  return input.completion?.ownsEnter === true
    ? on({ kind: "completion", action: { kind: "accept", alternate: null } }, "accept", true)
    : null;
}

function acceptCompletionThenAlternate(input: TableInput): Interaction | null {
  if (input.completion?.queueable !== true)
    return input.completion?.ownsEnter === true ? on({ kind: "noop" }, "send", true) : null;
  const alternate = alternateDelivery(input);

  return on({ kind: "completion", action: { kind: "accept", alternate } }, alternate, true);
}

function closeCompletion(): Interaction | null {
  return on({ kind: "completion", action: { kind: "close" } }, "close", true);
}

function refuseWhileShell(input: TableInput): Interaction | null {
  if (input.draft.kind === "shell")
    return on(
      { kind: "refuse", reason: "A local command is running. Esc stops it; your draft is kept." },
      "send",
      true,
    );

  if (input.draft.kind !== "message" || input.runsCommand) return null;

  return on(
    {
      kind: "refuse",
      reason: "A local command is running. Wait or press Esc; your draft is kept.",
    },
    "send",
    true,
  );
}

function stopShell(): Interaction | null {
  return on({ kind: "stop-shell" }, "stop command");
}

function stopShellQuietly(): Interaction | null {
  return on({ kind: "stop-shell" }, "stop command", true);
}

function saveEdit(input: TableInput): Interaction | null {
  if (input.editing === null) return null;

  return isMessage(input)
    ? on({ kind: "save-edit", delivery: input.editing.delivery }, "save")
    : on({ kind: "refuse", reason: "Type the message, or esc to cancel the edit" }, "save");
}

function saveEditAsSteer(input: TableInput): Interaction | null {
  return isMessage(input)
    ? on({ kind: "save-edit", delivery: "steer" }, "steer")
    : on({ kind: "noop" }, "steer", true);
}

function cancelEdit(): Interaction | null {
  return on({ kind: "cancel-edit" }, "cancel edit");
}

function clearOrCancelEdit(input: TableInput): Interaction | null {
  return input.draft.kind === "empty"
    ? on({ kind: "cancel-edit" }, "cancel edit", true)
    : on({ kind: "clear-draft" }, "clear draft");
}

function runShell(input: TableInput): Interaction | null {
  if (input.draft.kind !== "shell") return null;

  return on(
    { kind: "run-shell", command: input.draft.command, include: input.draft.include },
    input.draft.include ? "run locally" : "run privately",
  );
}

function answerOrOpenQuestion(input: TableInput): Interaction | null {
  const { question } = input;

  if (question === null) return null;

  if (input.draft.kind !== "message") return on({ kind: "open-question" }, "answer");

  if (input.draft.command !== null) return null;

  if (!input.draft.plain)
    return on(
      {
        kind: "send",
        delivery: "steer",
        warning: "Attachments can't answer a question; sent as a message instead.",
      },
      "send",
    );

  return on(
    {
      kind: "answer",
      session: question.session,
      part: question.part,
      value: input.draft.text,
      typed: true,
    },
    "answer",
  );
}

function sendSteer(input: TableInput): Interaction | null {
  return isMessage(input) ? on({ kind: "send", delivery: "steer" }, "steer") : null;
}

function stopRun(input: TableInput): Interaction | null {
  return input.run.kind === "idle" ? null : on({ kind: "stop-run" }, "stop");
}

function sendFollowUpOrPromote(input: TableInput): Interaction | null {
  const delivery = busyDelivery(input.followUp, false);

  if (isMessage(input)) return on({ kind: "send", delivery }, delivery);
  const head = promotable(input.queue);

  return head === null
    ? on({ kind: "noop" }, delivery)
    : on({ kind: "promote", message: head.id }, "send now");
}

function sendAlternate(input: TableInput): Interaction | null {
  const delivery = busyDelivery(input.followUp, true);

  return isMessage(input)
    ? on({ kind: "send", delivery }, delivery)
    : on({ kind: "noop" }, delivery, true);
}

function sendOrPromote(input: TableInput): Interaction | null {
  if (isMessage(input)) return on({ kind: "send", delivery: "queue" }, "send");
  const head = promotable(input.queue);

  return head === null
    ? on({ kind: "noop" }, "send")
    : on({ kind: "promote", message: head.id }, "send now");
}

function hiddenNone(input: TableInput): Interaction | null {
  return isMessage(input)
    ? on({ kind: "send", delivery: "queue" }, "send", true)
    : on({ kind: "noop" }, "send", true);
}

function treeOrRefuse(input: TableInput): Interaction | null {
  if (input.draft.kind === "message")
    return on(
      { kind: "refuse", reason: "Clear the draft before opening the tree" },
      "tree (twice)",
      true,
    );

  if (input.blocked !== null) return on({ kind: "noop" }, "tree (twice)", true);

  return on({ kind: "escape-tree", at: input.now }, "tree (twice)");
}

function clearOrQuit(input: TableInput): Interaction | null {
  return input.draft.kind === "empty"
    ? on({ kind: "quit" }, "quit")
    : on({ kind: "clear-draft" }, "clear draft");
}

export const SITUATIONS: readonly Row[] = [
  {
    name: "blocked",
    active: (input) => input.blocked !== null,
    cells: {
      "chat.submit": refuseBlocked,
      "chat.queue.submit": refuseBlocked,
      "chat.interrupt": cancelAuthentication,
      "chat.quit": pass,
    },
  },
  {
    name: "completion",
    active: (input) => input.completion !== null,
    cells: {
      "chat.submit": acceptCompletion,
      "chat.queue.submit": acceptCompletionThenAlternate,
      "chat.interrupt": closeCompletion,
      "chat.quit": pass,
    },
  },
  {
    name: "shell-running",
    active: (input) => input.shell !== null,
    cells: {
      "chat.submit": refuseWhileShell,
      "chat.queue.submit": refuseWhileShell,
      "chat.interrupt": stopShell,
      "chat.quit": stopShellQuietly,
    },
  },
  {
    name: "editing",
    active: (input) => input.editing !== null,
    cells: {
      "chat.submit": saveEdit,
      "chat.queue.submit": saveEditAsSteer,
      "chat.interrupt": cancelEdit,
      "chat.quit": clearOrCancelEdit,
    },
  },
  {
    name: "shell-draft",
    active: (input) => input.draft.kind === "shell",
    cells: {
      "chat.submit": runShell,
      "chat.queue.submit": pass,
      "chat.interrupt": pass,
      "chat.quit": pass,
    },
  },
  {
    name: "question",
    active: (input) => input.question !== null,
    cells: {
      "chat.submit": answerOrOpenQuestion,
      "chat.queue.submit": sendSteer,
      "chat.interrupt": stopRun,
      "chat.quit": pass,
    },
  },
  {
    name: "busy",
    active: (input) => input.run.kind !== "idle",
    cells: {
      "chat.submit": sendFollowUpOrPromote,
      "chat.queue.submit": sendAlternate,
      "chat.interrupt": stopRun,
      "chat.quit": pass,
    },
  },
  {
    name: "idle",
    active: () => true,
    cells: {
      "chat.submit": sendOrPromote,
      "chat.queue.submit": hiddenNone,
      "chat.interrupt": treeOrRefuse,
      "chat.quit": clearOrQuit,
    },
  },
];

function core(command: CoreCommand, input: TableInput): Interaction {
  for (const row of SITUATIONS) {
    if (!row.active(input)) continue;
    const decided = row.cells[command](input);

    if (decided !== null) return decided;
  }

  return OFF;
}

function isCore(command: ChatCommand): command is CoreCommand {
  return CORE_COMMANDS.some((candidate) => candidate === command);
}

const LIST_KEYS: readonly ChatCommand[] = [
  "picker.accept",
  "picker.close",
  "picker.previous",
  "picker.next",
  "picker.page.up",
  "picker.page.down",
];

export function dialogKeys(dialog: Dialog): readonly ChatCommand[] {
  switch (dialog.kind) {
    case "list":
      return [
        ...LIST_KEYS,
        ...(dialog.purpose.kind === "question"
          ? (["picker.detail.up", "picker.detail.down"] as const)
          : []),
        ...listActions(dialog.purpose).map((action) => action.command),
      ];
    case "model":
      return [
        "picker.accept",
        "picker.close",
        "picker.page.up",
        "picker.page.down",
        "model.previous",
        "model.next",
        "model.decrease",
        "model.increase",
        "model.field.cycle",
      ];
    case "tree":
      return [
        "picker.accept",
        "picker.previous",
        "picker.next",
        "tree.close",
        "tree.page.up",
        "tree.page.down",
        "tree.fold",
        "tree.unfold",
        "tree.filter.default",
        "tree.filter.tools",
        "tree.filter.users",
        "tree.filter.all",
        "tree.filter.next",
        "tree.filter.previous",
        "tree.copy",
      ];
    case "inspector":
      return [
        "picker.close",
        "picker.previous",
        "picker.next",
        "picker.page.up",
        "picker.page.down",
        "chat.tools.toggle",
        "chat.scroll.latest",
        "chat.message.previous",
        "chat.message.next",
        "chat.task.stop",
      ];
    case "text":
      return [...LIST_KEYS, "tree.close", "chat.message.previous", "chat.message.next"];
    case "auth":
      return [
        "auth.cancel",
        "auth.submit",
        "auth.open",
        "auth.copy",
        "picker.previous",
        "picker.next",
      ];
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

const DIALOG_ONLY = (command: ChatCommand): boolean =>
  command.startsWith("picker.") ||
  command.startsWith("model.") ||
  command.startsWith("tree.") ||
  command.startsWith("auth.") ||
  command === "chat.queue.edit" ||
  command === "chat.queue.delete" ||
  command === "chat.queue.up" ||
  command === "chat.queue.down" ||
  command === "chat.task.stop";

export function interactionsFor(input: TableInput): Interactions {
  const { dialog } = input;

  if (dialog !== null) {
    const keys = new Set(dialogKeys(dialog));

    return entries((command) =>
      keys.has(command)
        ? {
            intent: { kind: "dialog", command: { kind: "key", name: command } },
            label: "",
            hidden: true,
          }
        : OFF,
    );
  }

  return entries((command) =>
    isCore(command) ? core(command, input) : otherInteraction(command, input),
  );
}

function entries(decide: (command: ChatCommand) => Interaction): Interactions {
  return {
    "chat.submit": decide("chat.submit"),
    "chat.quit": decide("chat.quit"),
    "completion.accept": decide("completion.accept"),
    "completion.fill": decide("completion.fill"),
    "completion.close": decide("completion.close"),
    "completion.previous": decide("completion.previous"),
    "completion.next": decide("completion.next"),
    "completion.page.up": decide("completion.page.up"),
    "completion.page.down": decide("completion.page.down"),
    "chat.interrupt": decide("chat.interrupt"),
    "chat.scroll.page.up": decide("chat.scroll.page.up"),
    "chat.scroll.page.down": decide("chat.scroll.page.down"),
    "chat.scroll.latest": decide("chat.scroll.latest"),
    "chat.message.previous": decide("chat.message.previous"),
    "chat.message.next": decide("chat.message.next"),
    "chat.thinking.cycle": decide("chat.thinking.cycle"),
    "chat.model.next": decide("chat.model.next"),
    "chat.model.previous": decide("chat.model.previous"),
    "chat.editor.open": decide("chat.editor.open"),
    "chat.attachment.open": decide("chat.attachment.open"),
    "chat.clipboard.paste": decide("chat.clipboard.paste"),
    "chat.queue.open": decide("chat.queue.open"),
    "chat.queue.submit": decide("chat.queue.submit"),
    "chat.queue.edit": decide("chat.queue.edit"),
    "chat.queue.delete": decide("chat.queue.delete"),
    "chat.queue.up": decide("chat.queue.up"),
    "chat.queue.down": decide("chat.queue.down"),
    "chat.task.stop": decide("chat.task.stop"),
    "chat.tools.toggle": decide("chat.tools.toggle"),
    "chat.skills.open": decide("chat.skills.open"),
    "chat.commands.open": decide("chat.commands.open"),
    "chat.history.previous": decide("chat.history.previous"),
    "chat.history.next": decide("chat.history.next"),
    "composer.newline": decide("composer.newline"),
    "composer.delete.to.line.start": decide("composer.delete.to.line.start"),
    "composer.yank": decide("composer.yank"),
    "picker.accept": decide("picker.accept"),
    "picker.close": decide("picker.close"),
    "picker.previous": decide("picker.previous"),
    "picker.next": decide("picker.next"),
    "picker.page.up": decide("picker.page.up"),
    "picker.page.down": decide("picker.page.down"),
    "picker.detail.up": decide("picker.detail.up"),
    "picker.detail.down": decide("picker.detail.down"),
    "model.previous": decide("model.previous"),
    "model.next": decide("model.next"),
    "model.decrease": decide("model.decrease"),
    "model.increase": decide("model.increase"),
    "model.field.cycle": decide("model.field.cycle"),
    "tree.close": decide("tree.close"),
    "tree.page.up": decide("tree.page.up"),
    "tree.page.down": decide("tree.page.down"),
    "tree.fold": decide("tree.fold"),
    "tree.unfold": decide("tree.unfold"),
    "tree.filter.default": decide("tree.filter.default"),
    "tree.filter.tools": decide("tree.filter.tools"),
    "tree.filter.users": decide("tree.filter.users"),
    "tree.filter.all": decide("tree.filter.all"),
    "tree.filter.next": decide("tree.filter.next"),
    "tree.filter.previous": decide("tree.filter.previous"),
    "tree.copy": decide("tree.copy"),
    "auth.cancel": decide("auth.cancel"),
    "auth.submit": decide("auth.submit"),
    "auth.open": decide("auth.open"),
    "auth.copy": decide("auth.copy"),
  };
}

export function otherInteraction(
  command: Exclude<ChatCommand, CoreCommand>,
  input: TableInput,
): Interaction {
  if (command.startsWith("completion.")) return completionInteraction(command, input.completion);

  if (command.startsWith("composer.") || DIALOG_ONLY(command)) return OFF;

  if (input.blocked !== null) return OFF;

  if (command === "chat.commands.open")
    return on({ kind: "open", dialog: { kind: "list", purpose: { kind: "palette" } } }, "help");

  if (input.completion !== null) return OFF;

  switch (command) {
    case "chat.scroll.page.up":
      return on({ kind: "scroll", to: "page-up" }, "scroll up", true);
    case "chat.scroll.page.down":
      return on({ kind: "scroll", to: "page-down" }, "scroll down", true);
    case "chat.scroll.latest":
      return on({ kind: "scroll", to: "latest" }, "latest", true);
    case "chat.message.previous":
      return on({ kind: "scroll", to: "previous-turn" }, "previous message", true);
    case "chat.message.next":
      return on({ kind: "scroll", to: "next-turn" }, "next message", true);
    case "chat.thinking.cycle":
      return on({ kind: "cycle-thinking" }, "thinking");
    case "chat.model.next":
      return on({ kind: "cycle-model", direction: 1 }, "model");
    case "chat.model.previous":
      return on({ kind: "cycle-model", direction: -1 }, "previous model", true);
    case "chat.editor.open":
      return on({ kind: "open-editor" }, "editor", true);
    case "chat.attachment.open":
      return on({ kind: "open-attachment" }, "attachment", true);
    case "chat.clipboard.paste":
      return on({ kind: "paste", source: { kind: "clipboard" } }, "paste", true);
    case "chat.queue.open": {
      const first = input.queue[0];

      return first === undefined
        ? on({ kind: "refuse", reason: "Nothing is queued", tone: "info" }, "queue", true)
        : on(
            {
              kind: "open",
              dialog: { kind: "list", purpose: { kind: "queue", message: first.id } },
            },
            "queue",
            true,
          );
    }

    case "chat.tools.toggle":
      return on({ kind: "toggle-tool-output" }, "tool output", true);
    case "chat.skills.open":
      return on(
        { kind: "open", dialog: { kind: "list", purpose: { kind: "skills" } } },
        "skills",
        true,
      );
    case "chat.history.previous":
      if (input.cursor.row !== "first" && input.cursor.row !== "only") return OFF;

      return on({ kind: "history", direction: "previous" }, "previous history", true);
    case "chat.history.next":
      if (input.cursor.row !== "last" && input.cursor.row !== "only") return OFF;

      if (input.draft.kind === "empty" && !input.browsing && input.tasks > 0)
        return on(
          { kind: "open", dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } } },
          "view tasks",
        );

      return on({ kind: "history", direction: "next" }, "next history", true);
    default:
      return OFF;
  }
}

function completionInteraction(
  command: ChatCommand,
  completion: CompletionModel | null,
): Interaction {
  if (completion === null) return OFF;

  if (completion.items.length === 0 && command !== "completion.close") return OFF;

  switch (command) {
    case "completion.accept":
      return completion.ownsEnter
        ? on({ kind: "completion", action: { kind: "accept", alternate: null } }, "accept")
        : OFF;
    case "completion.fill":
      return on({ kind: "completion", action: { kind: "fill" } }, "complete");
    case "completion.close":
      return on({ kind: "completion", action: { kind: "close" } }, "close");
    case "completion.previous":
      return on({ kind: "completion", action: { kind: "move", by: -1 } }, "previous");
    case "completion.next":
      return on({ kind: "completion", action: { kind: "move", by: 1 } }, "next");
    case "completion.page.up":
      return on({ kind: "completion", action: { kind: "move", by: "page-up" } }, "page up");
    case "completion.page.down":
      return on({ kind: "completion", action: { kind: "move", by: "page-down" } }, "page down");
    default:
      return OFF;
  }
}

function isChatCommand(name: string): name is ChatCommand {
  return Object.hasOwn(CHAT_KEYBINDS, name);
}

let commandList: readonly ChatCommand[] | null = null;

export function chatCommands(): readonly ChatCommand[] {
  commandList ??= Object.keys(CHAT_KEYBINDS).filter(isChatCommand);

  return commandList;
}
