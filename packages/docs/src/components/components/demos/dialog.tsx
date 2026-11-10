import { AlertDialog, ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { useState } from "react";

export function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="outline">Rename session</Button>} />
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>Rename session</Dialog.Title>
          <Dialog.Description>
            The name shows in the sidebar and in the window title.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="outline">Cancel</Button>} />
          <Dialog.Close
            render={
              <Button variant="solid" tone="primary">
                Save
              </Button>
            }
          />
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function AlertDialogDemo() {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        render={
          <Button variant="solid" tone="danger">
            Delete chat
          </Button>
        }
      />
      <AlertDialog.Popup>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete chat</AlertDialog.Title>
          <AlertDialog.Description>
            The history tree and every head under it are removed. This cannot be undone.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Close render={<Button variant="outline">Cancel</Button>} />
          <AlertDialog.Close
            render={
              <Button variant="solid" tone="danger">
                Delete chat
              </Button>
            }
          />
        </AlertDialog.Footer>
      </AlertDialog.Popup>
    </AlertDialog.Root>
  );
}

export function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="solid" tone="danger" onClick={() => setOpen(true)}>
        Delete chat
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete chat"
        confirmLabel="Delete chat"
        description="This permanently deletes the chat and its entire history. You can't undo this."
        onOpenChange={setOpen}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
