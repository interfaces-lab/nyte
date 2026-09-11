"use client";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nyte-ai/ui";
import { Dialog as DialogPrimitive } from "@nyte-ai/ui/dialog";

export function DialogDemo() {
  return (
    <Dialog>
      <DialogPrimitive.Trigger render={<Button variant="outline" />}>
        Rename session
      </DialogPrimitive.Trigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            The name shows in the sidebar and in the window title.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogPrimitive.Close render={<Button variant="ghost" />}>Cancel</DialogPrimitive.Close>
          <DialogPrimitive.Close render={<Button />}>Save</DialogPrimitive.Close>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlertDialogDemo() {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Delete session
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete this session?</AlertDialogTitle>
        <AlertDialogDescription>
          The history tree and every head under it are removed. This cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />}>Delete</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
