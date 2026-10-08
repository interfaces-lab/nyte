import { AlertDialog } from "@base-ui/react/alert-dialog";
import { create, props } from "@stylexjs/stylex";
import { useRef } from "react";
import type { ReactElement, ReactNode } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent, type Tint } from "./surface-theme.ts";
import { role, type } from "./vars.stylex.ts";
import { Button } from "./button.tsx";
import { Dialog } from "./dialog.tsx";

const styles = create({
  text: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});

function AlertDialogTrigger({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<AlertDialog.Trigger.Props>): ReactElement {
  return <AlertDialog.Trigger {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

/** The dialog's parts under a root that ignores outside presses and announces as `alertdialog`. */
const alertDialogParts = {
  Root: AlertDialog.Root,
  Trigger: AlertDialogTrigger,
  Popup: Dialog.Popup,
  Header: Dialog.Header,
  Title: Dialog.Title,
  Description: Dialog.Description,
  Footer: Dialog.Footer,
  Close: Dialog.Close,
};

/** A destructive yes-or-no question. Focus starts on Cancel. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending = false,
  error,
  finalFocus,
  tint,
  onOpenChange,
  onConfirm,
}: Required<Pick<AlertDialog.Root.Props, "open" | "onOpenChange">> &
  Pick<AlertDialog.Popup.Props, "finalFocus"> & {
    readonly title: string;
    readonly description: ReactNode;
    readonly confirmLabel: string;
    readonly pendingLabel?: string;
    readonly pending?: boolean;
    readonly error?: string;
    readonly tint?: Tint;
    readonly onConfirm: () => void;
  }): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <alertDialogParts.Root
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;

        if (pending) {
          eventDetails.cancel();

          return;
        }

        onOpenChange(false, eventDetails);
      }}
    >
      <alertDialogParts.Popup
        tint={tint}
        initialFocus={cancelRef}
        finalFocus={finalFocus}
        aria-busy={pending}
      >
        <alertDialogParts.Header>
          <alertDialogParts.Title>{title}</alertDialogParts.Title>
          <alertDialogParts.Description>{description}</alertDialogParts.Description>
        </alertDialogParts.Header>
        {error !== undefined && (
          <p role="alert" {...props(intent.danger, styles.text)}>
            {error}
          </p>
        )}
        {pending && pendingLabel !== undefined && (
          <p role="status" {...props(styles.text)}>
            {pendingLabel}
          </p>
        )}
        <alertDialogParts.Footer>
          <alertDialogParts.Close
            ref={cancelRef}
            render={
              <Button variant="outline" loading={pending}>
                Cancel
              </Button>
            }
          />
          <Button variant="solid" tone="danger" loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </alertDialogParts.Footer>
      </alertDialogParts.Popup>
    </alertDialogParts.Root>
  );
}

export { alertDialogParts as AlertDialog };
