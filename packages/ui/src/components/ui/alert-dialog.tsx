import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { create, props } from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { Button } from "./button.tsx";
import { Dialog } from "./dialog.tsx";

const styles = create({
  error: { margin: 0, color: t.textDanger, fontSize: t.fontBase, lineHeight: t.leadingBase },
});

export type AlertDialogRootProps = AlertDialogPrimitive.Root.Props;

export type AlertDialogTriggerProps = StyledProps<AlertDialogPrimitive.Trigger.Props>;

function AlertDialogTrigger({
  xstyle,
  className,
  style,
  ...rest
}: AlertDialogTriggerProps): ReactElement {
  return (
    <AlertDialogPrimitive.Trigger {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
  );
}

/** The dialog's parts under a root that ignores outside presses and announces as `alertdialog`. */
export const AlertDialog = {
  Root: AlertDialogPrimitive.Root,
  Trigger: AlertDialogTrigger,
  Popup: Dialog.Popup,
  Header: Dialog.Header,
  Title: Dialog.Title,
  Description: Dialog.Description,
  Footer: Dialog.Footer,
  Close: Dialog.Close,
};

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel?: string;
  readonly pendingLabel?: string;
  /** Disables both actions and keeps the dialog open until it settles. */
  readonly pending?: boolean;
  readonly error?: string;
  /** Where focus lands on close when the dialog has no trigger. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/** A destructive yes-or-no question. Focus starts on Cancel. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  pending = false,
  error,
  returnFocusRef,
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
      <AlertDialog.Popup initialFocus={cancelRef} finalFocus={returnFocusRef} aria-busy={pending}>
        <AlertDialog.Header>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
        </AlertDialog.Header>
        {error !== undefined && (
          <p role="alert" {...props(styles.error)}>
            {error}
          </p>
        )}
        <AlertDialog.Footer>
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
        </AlertDialog.Footer>
      </AlertDialog.Popup>
    </AlertDialog.Root>
  );
}
