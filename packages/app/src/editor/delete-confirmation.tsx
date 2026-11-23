import { useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { removeForGood } from "./explorer-operations.ts";
import type { DeleteTarget } from "./explorer-operations.ts";

/** Asks before deleting an entry the workspace can't hold for undo, then deletes it for good. */
export function DeleteConfirmation({
  confirming,
  onClose,
}: {
  readonly confirming: DeleteTarget | undefined;
  readonly onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();

  return (
    <ConfirmDialog
      open={confirming !== undefined}
      title={`Delete ${confirming?.name ?? ""}?`}
      description="This workspace can't hold deleted files for undo, so it's deleted for good."
      confirmLabel="Delete"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onConfirm={() => {
        onClose();

        if (confirming !== undefined) {
          void removeForGood(queryClient, confirming.workspace, confirming.path);
        }
      }}
    />
  );
}
