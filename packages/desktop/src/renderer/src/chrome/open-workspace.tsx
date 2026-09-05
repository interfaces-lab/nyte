/**
 * Trust is requested when sending. Folder selection failures appear as a
 * dismissible toast, leaving the current chat usable.
 */
import { Dialog } from "@nyte-ai/ui/primitives";
import { toast } from "@nyte-ai/ui/sonner";
import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../components/ui";
import { keys, queryClient } from "../queries.ts";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { nyte } from "../nyte.ts";
import type { OpenWorkspaceOutcome } from "../nyte.ts";

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
    width: "min(460px, calc(100vw - 48px))",
    maxHeight: "calc(100dvh - 48px)",
    padding: 20,
    overflowY: "auto",
    borderStyle: "none",
    borderRadius: t.radiusXl,
    outline: "none",
    backgroundColor: t.bgElevated,
    color: t.textPrimary,
    boxShadow: t.shadowModal,
    transform: "translate(-50%, -50%)",
  },
  inner: { display: "flex", flexDirection: "column", gap: 14 },
  title: { fontSize: t.fontLg, fontWeight: 600, color: t.textPrimary },
  path: {
    padding: "6px 10px",
    borderRadius: t.radiusBase,
    backgroundColor: t.bgFaint,
    color: t.textSecondary,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  body: { color: t.textSecondary, fontSize: t.fontBase },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
});

let prompt: string | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): string | undefined {
  return prompt;
}

function setPrompt(next: string | undefined): void {
  prompt = next;
  for (const listener of listeners) listener();
}

/** Route a folder-open outcome to the shared dialog host. */
export function handleOpenOutcome(outcome: OpenWorkspaceOutcome): void {
  switch (outcome.kind) {
    case "needs_trust":
      toast.dismiss("workspace-open");
      setPrompt(outcome.path);
      return;
    case "failed":
      setPrompt(undefined);
      toast.error("Couldn't open folder", {
        id: "workspace-open",
        description: outcome.message,
        duration: Infinity,
      });
      return;
    case "opened":
    case "cancelled":
      toast.dismiss("workspace-open");
      setPrompt(undefined);
      return;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function grantTrust(path: string): void {
  setPrompt(undefined);
  void nyte.host.trustWorkspace({ path }).then((outcome) => {
    handleOpenOutcome(outcome);
    void queryClient.invalidateQueries({ queryKey: keys.workspaces });
    void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });
  });
}

function Modal({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDismiss()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup aria-label={label} {...stylex.props(styles.popup)}>
          <div {...stylex.props(styles.inner)}>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted once in the shell; renders whichever prompt is live. */
export function WorkspaceDialogHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, snapshot);
  if (current === undefined) return null;

  return (
    <Modal key={current} label="Do you trust this folder?" onDismiss={() => setPrompt(undefined)}>
      <div {...stylex.props(styles.title)}>Do you trust this folder?</div>
      <div {...stylex.props(styles.path)}>{current}</div>
      <div {...stylex.props(styles.body)}>
        Nyte can execute code and access files in this folder. Project plugins and skills load only
        after you trust it.
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" autoFocus onClick={() => setPrompt(undefined)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => grantTrust(current)}>
          Trust and continue
        </Button>
      </div>
    </Modal>
  );
}
