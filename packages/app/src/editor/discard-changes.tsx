import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { useState } from "react";
import type { ReactElement, RefObject } from "react";
import { errorMessage } from "../contract/errors.ts";
import type { FileEditorHandle } from "./file-editor.tsx";
import type { FileTab } from "./file-store.ts";

/** Confirms a discard request, then reloads the file from disk in its editor. */
export function DiscardChanges({
  discardPath,
  onClose,
  menuRef,
  tabs,
  editors,
}: {
  readonly discardPath: string | undefined;
  readonly onClose: () => void;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
  readonly tabs: readonly FileTab[];
  readonly editors: RefObject<Map<string, FileEditorHandle>>;
}): ReactElement {
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string>();
  const [requested, setRequested] = useState(discardPath);

  if (requested !== discardPath) {
    setRequested(discardPath);

    if (discardPath !== undefined) setDiscardError(undefined);
  }

  const discard = async (): Promise<void> => {
    if (discardPath === undefined) return;
    setDiscarding(true);
    const holder = tabs.find((tab) => tab.path === discardPath);

    const failure = await discardEdits(
      holder === undefined ? undefined : editors.current.get(holder.id),
    );

    setDiscarding(false);

    if (failure !== undefined) {
      setDiscardError(failure);

      return;
    }

    onClose();
    setDiscardError(undefined);
  };

  return (
    <ConfirmDialog
      open={discardPath !== undefined}
      pending={discarding}
      error={discardError}
      finalFocus={menuRef}
      title="Discard Changes"
      description="Your unsaved edits will be replaced by the current file on disk."
      confirmLabel="Discard Changes"
      pendingLabel="Reloading…"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onConfirm={() => void discard()}
    />
  );
}

async function discardEdits(editor: FileEditorHandle | undefined): Promise<string | undefined> {
  if (editor === undefined) return "The file is not ready to reload.";

  try {
    await editor.discard();

    return undefined;
  } catch (cause: unknown) {
    return errorMessage(cause);
  }
}
