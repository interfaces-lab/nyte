import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { useRef, useState } from "react";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import { errorMessage } from "../contract/errors.ts";
import type { FileEditorHandle } from "./file-editor.tsx";
import type { FileTab } from "./file-store.ts";

/** Which file's edits are being discarded, and the control focus returns to when the dialog closes. */
export interface DiscardRequest {
  readonly discardPath: string | undefined;
  readonly setDiscardPath: Dispatch<SetStateAction<string | undefined>>;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
}

/** Holds a request to discard a file's unsaved edits. */
export function useDiscardRequest(): DiscardRequest {
  const [discardPath, setDiscardPath] = useState<string>();
  const menuRef = useRef<HTMLButtonElement>(null);

  return { discardPath, setDiscardPath, menuRef };
}

/** Confirms a discard request, then reloads the file from disk in its editor. */
export function DiscardChanges({
  discardPath,
  setDiscardPath,
  menuRef,
  tabs,
  editors,
}: DiscardRequest & {
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

    setDiscardPath(undefined);
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
        if (!open) setDiscardPath(undefined);
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
