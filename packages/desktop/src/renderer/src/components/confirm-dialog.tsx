import { AlertDialog } from "@nyte-ai/ui/alert-dialog";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { Button } from "./ui.tsx";

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: t.bgScrim,
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: layer.dialog,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "min(400px, calc(100vw - 48px))",
    maxHeight: "calc(100dvh - 48px)",
    padding: 16,
    overflowY: "auto",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: t.radiusLg,
    outline: "none",
    backgroundColor: t.bgElevated,
    boxShadow: t.shadowModal,
    color: t.textPrimary,
    transform: "translate(-50%, -50%)",
  },
  copy: { display: "flex", flexDirection: "column", gap: 4 },
  title: {
    margin: 0,
    color: t.textPrimary,
    fontSize: t.fontLg,
    fontWeight: 600,
    lineHeight: t.leadingLg,
  },
  description: {
    margin: 0,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  error: { margin: 0, color: t.textDanger, fontSize: t.fontBase, lineHeight: t.leadingBase },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
});

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly title?: string;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly pendingLabel?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  pending,
  error,
  returnFocusRef,
  title = "Delete chat?",
  description = <>This permanently deletes the chat and its history. This can&rsquo;t be undone.</>,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onOpenChange(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop {...stylex.props(styles.backdrop)} />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          finalFocus={returnFocusRef}
          aria-busy={pending}
          {...stylex.props(styles.popup)}
        >
          <div {...stylex.props(styles.copy)}>
            <AlertDialog.Title {...stylex.props(styles.title)}>{title}</AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(styles.description)}>
              {description}
            </AlertDialog.Description>
          </div>
          {error !== undefined && (
            <p role="alert" {...stylex.props(styles.error)}>
              {error}
            </p>
          )}
          <div {...stylex.props(styles.actions)}>
            <AlertDialog.Close
              ref={cancelRef}
              disabled={pending}
              render={<Button variant="secondary" />}
            >
              Cancel
            </AlertDialog.Close>
            <Button variant="danger" disabled={pending} onClick={onConfirm}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
