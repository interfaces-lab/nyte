/**
 * The task inspector: a child's transcript (reusing `deriveTranscript` over
 * the child's view from `facts.tasks`) or a job's output tail. Its scroll
 * and follow state are its own, never the main transcript's.
 */
import type { DialogCommand, DialogId, DialogStep } from "./dialog.ts";

export interface InspectorDialog {
  readonly kind: "inspector";
  readonly id: DialogId;
  readonly task: string;
  readonly following: boolean;
  /**
   * The last scroll the user asked for; `seq` grows with every request so the
   * inspector's own scrollbox applies each one once. Null until the first.
   */
  readonly scroll: { readonly seq: number; readonly by: InspectorScroll } | null;
}

export type InspectorScroll = "line-up" | "line-down" | "page-up" | "page-down" | "bottom";

function scrolled(
  dialog: InspectorDialog,
  by: InspectorScroll,
  following: boolean,
): DialogStep<InspectorDialog> {
  return {
    dialog: { ...dialog, following, scroll: { seq: (dialog.scroll?.seq ?? 0) + 1, by } },
    intents: [],
    push: null,
  };
}

/** Esc back · ↑/↓ PgUp/PgDn scroll · Ctrl+O follow · Ctrl+End latest · Ctrl+↑/↓ previous/next task · Ctrl+X stop-task. */
export function reduceInspector(
  dialog: InspectorDialog,
  command: DialogCommand,
): DialogStep<InspectorDialog> {
  if (command.kind === "close") return { dialog: null, intents: [], push: null };

  if (command.kind !== "key") return { dialog, intents: [], push: null };

  switch (command.name) {
    case "picker.close":
    case "chat.interrupt":
      return { dialog: null, intents: [], push: null };
    case "picker.previous":
    case "chat.history.previous":
      return scrolled(dialog, "line-up", false);
    case "picker.next":
    case "chat.history.next":
      return scrolled(dialog, "line-down", false);
    case "picker.page.up":
    case "chat.scroll.page.up":
      return scrolled(dialog, "page-up", false);
    case "picker.page.down":
    case "chat.scroll.page.down":
      return scrolled(dialog, "page-down", false);
    case "chat.scroll.latest":
      return scrolled(dialog, "bottom", true);
    case "chat.tools.toggle":
      return dialog.following
        ? { dialog: { ...dialog, following: false }, intents: [], push: null }
        : scrolled(dialog, "bottom", true);
    case "chat.message.previous":
      return {
        dialog,
        intents: [{ kind: "step-task", dialog: dialog.id, direction: -1 }],
        push: null,
      };
    case "chat.message.next":
      return {
        dialog,
        intents: [{ kind: "step-task", dialog: dialog.id, direction: 1 }],
        push: null,
      };
    case "chat.task.stop":
      return { dialog, intents: [{ kind: "stop-task", task: dialog.task }], push: null };
    default:
      return { dialog, intents: [], push: null };
  }
}
