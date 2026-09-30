/**
 * Trust is requested when a session reports it through an observer snapshot
 * or activation event. Folder selection failures appear as a dismissible
 * toast, leaving the current chat usable.
 */
import { Dialog } from "@nyte-ai/ui/dialog";
import { toast } from "@nyte-ai/ui/toast";
import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { SessionActivationState } from "@nyte-ai/protocol";
import { Button } from "@nyte-ai/ui/button";
import { keys, queryClient } from "../queries.ts";
import { t } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte.ts";
import type { HostBridge, OpenWorkspaceOutcome } from "../bridge.ts";

const styles = stylex.create({
  popup: {
    gap: 12,
    width: "min(460px, calc(100vw - 48px))",
    padding: 20,
    borderStyle: "none",
  },
  title: { lineHeight: t.leadingBase },
  path: {
    padding: "6px 10px",
    borderRadius: t.radius6,
    backgroundColor: t.bgMutedTranslucent,
    color: t.contentSecondary,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
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

function grantTrust(trust: NonNullable<HostBridge["trustWorkspace"]>, path: string): void {
  declined.delete(path);
  setPrompt(undefined);
  void trust({ path }).then((outcome) => {
    handleOpenOutcome(outcome);
    void queryClient.invalidateQueries({ queryKey: keys.workspaces });
    void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });
  });
}

/** The native folder picker, then open. Absent where the host has no picker to show. */
export function folderPicker(): (() => void) | undefined {
  const pick = nyte.host.pickWorkspace;

  return pick === undefined ? undefined : () => void pick().then(handleOpenOutcome);
}

/** Mounted once in the shell; renders whichever prompt is live. */
export function WorkspaceDialogHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, snapshot);
  const trust = nyte.host.trustWorkspace;

  if (current === undefined) return null;

  return (
    <Dialog.Root key={current} defaultOpen onOpenChange={(open) => !open && declineTrust(current)}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={styles.title}>
          {trust === undefined ? "This folder is not trusted" : "Do you trust this folder?"}
        </Dialog.Title>
        <div {...stylex.props(styles.path)}>{current}</div>
        <Dialog.Description>
          {trust === undefined
            ? "Trust it on the machine running the server. Nyte runs code and reads files only in trusted folders."
            : "Nyte can execute code and access files in this folder. Project plugins and skills load only after you trust it."}
        </Dialog.Description>
        <Dialog.Footer>
          {trust === undefined ? (
            <Button autoFocus onClick={() => declineTrust(current)}>
              Close
            </Button>
          ) : (
            <>
              <Button autoFocus onClick={() => declineTrust(current)}>
                Cancel
              </Button>
              <Button variant="inverse" onClick={() => grantTrust(trust, current)}>
                Trust and continue
              </Button>
            </>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
