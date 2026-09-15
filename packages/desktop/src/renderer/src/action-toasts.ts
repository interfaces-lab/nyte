import { toast } from "@nyte-ai/ui/sonner";

interface UndoableAction {
  undo(): void;
  /** Irreversible work starts only when the notification closes without Undo. */
  commit?(): void;
}

interface ActionBatch {
  readonly id: string;
  readonly label: string;
  readonly actions: Set<UndoableAction>;
  revision: number;
}

/** Repeated clicks update one notification and Undo reverses that whole batch. */
export class ActionToasts {
  readonly #batches = new Map<string, ActionBatch>();
  #nextId = 0;

  add(label: string, action: UndoableAction): () => void {
    const batch = this.#batches.get(label) ?? {
      id: `session-action-${label}-${++this.#nextId}`,
      label,
      actions: new Set<UndoableAction>(),
      revision: 0,
    };
    this.#batches.set(label, batch);
    batch.actions.add(action);
    this.#show(batch);
    return () => {
      if (this.#batches.get(label) !== batch) return;
      batch.actions.delete(action);
      if (batch.actions.size > 0) this.#show(batch);
      else {
        this.#batches.delete(label);
        toast.dismiss(batch.id);
      }
    };
  }

  undo(id: ReturnType<typeof toast.success>): void {
    const batch = this.#batches.values().find((entry) => entry.id === id);
    if (batch !== undefined) this.#finish(batch, true);
  }

  #finish(batch: ActionBatch, undo: boolean): void {
    if (this.#batches.get(batch.label) !== batch) return;
    this.#batches.delete(batch.label);
    for (const action of [...batch.actions].reverse()) {
      if (undo) action.undo();
      else action.commit?.();
    }
  }

  #show(batch: ActionBatch): void {
    const count = batch.actions.size;
    toast.success(`${count} ${count === 1 ? "chat" : "chats"} ${batch.label}`, {
      id: batch.id,
      // Sonner resets its remaining time when duration changes, not title.
      duration: 6_000 + ++batch.revision,
      description:
        batch.label === "deleted"
          ? "Permanently deleted when this notification closes."
          : undefined,
      action: { label: "Undo", onClick: () => this.undo(batch.id) },
      onDismiss: () => this.#finish(batch, false),
      onAutoClose: () => this.#finish(batch, false),
    });
  }
}
