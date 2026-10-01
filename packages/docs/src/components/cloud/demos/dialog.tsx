"use client";

import { AlertDialog, Button, ConfirmDialog, Dialog } from "@nyte-ai/ui";
import { useState } from "react";

export function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="outline">Rename Session</Button>} />
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>Rename Session</Dialog.Title>
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
            Delete Session
          </Button>
        }
      />
      <AlertDialog.Popup>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete Session</AlertDialog.Title>
          <AlertDialog.Description>
            The history tree and every head under it are removed. This cannot be undone.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Close render={<Button variant="outline">Cancel</Button>} />
          <AlertDialog.Close
            render={
              <Button variant="solid" tone="danger">
                Delete Session
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
        Delete Chat
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete Chat"
        confirmLabel="Delete Chat"
        description="The chat and its history are removed."
        onOpenChange={setOpen}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
