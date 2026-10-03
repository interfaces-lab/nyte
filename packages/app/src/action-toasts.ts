import { toast } from "@nyte-ai/ui/toast";

interface UndoableAction {
  undo(): void;
  /** Irreversible work starts only when the notification closes without Undo. */
  commit?(): void;
}

interface ActionBatch {
  readonly id: string;
  readonly label: string;
  readonly actions: Set<UndoableAction>;
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
        toast.close(batch.id);
      }
    };
  }

  undo(id: string): void {
    const batch = this.#batches.values().find((entry) => entry.id === id);

    if (batch === undefined) return;
    this.#finish(batch, true);
    toast.close(id);
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
    toast.add({
      type: "success",
      title: `${count} ${count === 1 ? "chat" : "chats"} ${batch.label}`,
      id: batch.id,
      timeout: 6_000,
      description:
        batch.label === "deleted"
          ? "Permanently deleted when this notification closes."
          : undefined,
      actionProps: { children: "Undo", onClick: () => this.undo(batch.id) },
      onClose: () => this.#finish(batch, false),
    });
  }
}
