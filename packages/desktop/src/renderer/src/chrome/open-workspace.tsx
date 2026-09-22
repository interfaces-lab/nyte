/**
 * Trust is requested when a session reports it through an observer snapshot
 * or activation event. Folder selection failures appear as a dismissible
 * toast, leaving the current chat usable.
 */
import { Dialog } from "@nyte-ai/ui/dialog";
import { toast } from "@nyte-ai/ui/sonner";
import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionActivationState } from "@nyte-ai/protocol";
import { overlayRef } from "../components/overlay-occlusion.ts";
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
  inner: { display: "flex", flexDirection: "column", gap: 12 },
  title: { fontSize: t.fontLg, fontWeight: 600, color: t.textPrimary },
  path: {
    padding: "6px 10px",
    borderRadius: t.radiusBase,
    backgroundColor: t.fillSecondary,
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

/** Folders the user declined this session; a replayed activation must not nag. */
const declined = new Set<string>();

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

/** A session's activation says the folder needs trust; ask once per folder until granted. */
export function requestTrust(activation: SessionActivationState): void {
  if (activation.kind !== "requires") return;
  const path = activation.requirement.cwd;

  if (declined.has(path)) return;
  toast.dismiss("workspace-open");
  setPrompt(path);
}

function declineTrust(path: string): void {
  declined.add(path);
  setPrompt(undefined);
}

function grantTrust(path: string): void {
  declined.delete(path);
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
    <Dialog.Root defaultOpen onOpenChange={(open) => !open && onDismiss()}>
      <Dialog.Portal>
        <Dialog.Backdrop ref={overlayRef} {...stylex.props(styles.backdrop)} />
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
    <Modal key={current} label="Do you trust this folder?" onDismiss={() => declineTrust(current)}>
      <div {...stylex.props(styles.title)}>Do you trust this folder?</div>
      <div {...stylex.props(styles.path)}>{current}</div>
      <div {...stylex.props(styles.body)}>
        Nyte can execute code and access files in this folder. Project plugins and skills load only
        after you trust it.
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" autoFocus onClick={() => declineTrust(current)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => grantTrust(current)}>
          Trust and continue
        </Button>
      </div>
    </Modal>
  );
}
