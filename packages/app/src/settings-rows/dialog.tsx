import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";

export function SettingsDialog({
  open,
  title,
  description,
  onOpenChange,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          {description !== undefined && <Dialog.Description>{description}</Dialog.Description>}
        </Dialog.Header>
        {children}
        <Dialog.Footer>
          <Dialog.Close
            render={
              <Button variant="solid" tone="primary">
                Done
              </Button>
            }
          />
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function SettingsFormDialog({
  open,
  title,
  description,
  submitLabel,
  canSubmit,
  pending = false,
  error,
  onOpenChange,
  onSubmit,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly submitLabel: string;
  readonly canSubmit: boolean;
  readonly pending?: boolean;
  readonly error?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <Dialog.Popup xstyle={styles.popup} aria-busy={pending}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          {description !== undefined && <Dialog.Description>{description}</Dialog.Description>}
        </Dialog.Header>
        <form
          {...props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();

            if (canSubmit && !pending) onSubmit();
          }}
        >
          {children}
          {error !== undefined && (
            <p role="alert" {...props(text.base, intent.danger, styles.error)}>
              {error}
            </p>
          )}
          <Dialog.Footer>
            <Dialog.Close
              render={
                <Button variant="outline" disabled={pending}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              variant="solid"
              tone="primary"
              disabled={!canSubmit}
              loading={pending}
            >
              {submitLabel}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function SettingsField({
  label,
  hint,
  error,
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <label {...props(styles.field)}>
      <span {...props(text.sm, styles.label)}>{label}</span>
      {children}
      {error === undefined ? (
        hint !== undefined && <span {...props(text.sm, styles.hint)}>{hint}</span>
      ) : (
        <span role="alert" {...props(text.sm, intent.danger, styles.error)}>
          {error}
        </span>
      )}
    </label>
  );
}

export function SettingsDialogCard({ children }: { readonly children: ReactNode }): ReactElement {
  return <div {...props(settingsPatterns.group, styles.card)}>{children}</div>;
}

const styles = create({
  popup: { width: "min(440px, calc(100vw - 48px))", padding: space.s5, gap: space.s3 },
  form: { display: "flex", flexDirection: "column", gap: space.s3 },
  card: { borderRadius: radius.control },
  field: { display: "flex", flexDirection: "column", gap: space.s1_5 },
  label: { color: role.contentPrimary, fontWeight: type.weightMedium },
  hint: { color: role.contentTertiary, overflowWrap: "anywhere" },
  error: { margin: 0, color: role.contentAccent },
});
