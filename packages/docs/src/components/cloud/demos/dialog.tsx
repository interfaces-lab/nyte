"use client";

import { AlertDialog, Button, ConfirmDialog, Dialog } from "@nyte-ai/ui";
import { useState } from "react";

export function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="secondary" />}>Rename session</Dialog.Trigger>
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>Rename session</Dialog.Title>
          <Dialog.Description>
            The name shows in the sidebar and in the window title.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" />}>Cancel</Dialog.Close>
          <Dialog.Close render={<Button variant="inverse" />}>Save</Dialog.Close>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function AlertDialogDemo() {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button variant="danger" />}>Delete session</AlertDialog.Trigger>
      <AlertDialog.Popup>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete this session?</AlertDialog.Title>
          <AlertDialog.Description>
            The history tree and every head under it are removed. This cannot be undone.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Close render={<Button variant="secondary" />}>Cancel</AlertDialog.Close>
          <AlertDialog.Close render={<Button variant="danger" />}>Delete</AlertDialog.Close>
        </AlertDialog.Footer>
      </AlertDialog.Popup>
    </AlertDialog.Root>
  );
}

export function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete chat
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete chat?"
        description="The chat and its history are removed."
        onOpenChange={setOpen}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
