import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * Trust is requested when a session reports it through an observer snapshot
 * or activation event. Folder selection failures appear as a dismissible
 * toast, leaving the current chat usable.
 */
import { Dialog } from "@nyte-ai/ui/dialog";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { SessionActivationState } from "@nyte-ai/protocol";
import { Button } from "@nyte-ai/ui/button";
import { keys, queryClient } from "../queries.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte.ts";
import type { HostBridge, OpenWorkspaceOutcome } from "../bridge.ts";

const styles = create({
  popup: {
    gap: 12,
    width: "min(460px, calc(100vw - 48px))",
    padding: 20,
    borderStyle: "none",
  },
  title: { lineHeight: type.leadingBase },
  path: {
    padding: "6px 10px",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

/**
 * The folder asking for trust and what asked. A grant after opening a folder
 * lands on a new chat there; a grant something in the current view asked for,
 * a running chat or a gated action, keeps that view.
 */
interface TrustPrompt {
  readonly path: string;
  readonly origin: "open" | "action";
}

let prompt: TrustPrompt | undefined;

/** Folders the user declined this session; a replayed activation must not nag. */
const declined = new Set<string>();

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): TrustPrompt | undefined {
  return prompt;
}

function setPrompt(next: TrustPrompt | undefined): void {
  prompt = next;

  for (const listener of listeners) listener();
}

/** Something in the current view needs trust: a session's activation or a gated host action. */
export function requestTrust(path: string): void {
  if (declined.has(path)) return;
  toast.close("workspace-open");

  // The open already asked for this folder; an echo must not retarget the grant.
  if (prompt?.path !== path) setPrompt({ path, origin: "action" });
}

/** Route a folder-open outcome to the shared dialog host. */
export function handleOpenOutcome(outcome: OpenWorkspaceOutcome): void {
  switch (outcome.kind) {
    case "needs_trust":
      toast.close("workspace-open");
      setPrompt({ path: outcome.path, origin: "open" });

      return;
    case "failed":
      setPrompt(undefined);
      toast.add({
        type: "error",
        title: "Couldn't open folder",
        id: "workspace-open",
        description: outcome.message,
        timeout: 0,
      });

      return;
    case "opened":
      toast.close("workspace-open");
      setPrompt(outcome.needsTrust ? { path: outcome.workspace.path, origin: "open" } : undefined);

      return;
    case "cancelled":
      toast.close("workspace-open");
      setPrompt(undefined);

      return;
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

let failedShown = false;

/** A session's activation says what it needs: trust, asked once per folder until granted, a workspace this host cannot open, or a plugin fix. */
export function observeActivation(activation: SessionActivationState): void {
  if (activation.kind !== "requires" || activation.requirement.kind !== "workspace_unavailable")
    toast.close("workspace-unavailable");

  switch (activation.kind) {
    case "requires": {
      const { requirement } = activation;

      if (requirement.kind === "workspace_unavailable") {
        let title: string;

        switch (requirement.reason) {
          case "unreachable":
            title = "Couldn't reach this session's workspace";
            break;
          case "unsupported":
            title = "Can't open this session's workspace";
            break;
          default: {
            const _exhaustive: never = requirement.reason;
            title = _exhaustive;
          }
        }

        toast.add({ type: "error", title, id: "workspace-unavailable", timeout: 0 });

        return;
      }

      requestTrust(requirement.cwd);

      return;
    }

    case "failed":
      failedShown = true;
      toast.add({
        type: "error",
        title: "Plugins failed to load",
        id: "plugins-failed",
        timeout: 0,
      });

      return;
    case "active":
      if (!failedShown) return;
      failedShown = false;
      toast.close("plugins-failed");

      return;
    case "inactive":
      return;
    default: {
      const _exhaustive: never = activation;

      return _exhaustive;
    }
  }
}

function declineTrust(path: string): void {
  declined.add(path);
  setPrompt(undefined);
}

function grantTrust(
  trust: NonNullable<HostBridge["trustWorkspace"]>,
  path: string,
): Promise<boolean> {
  declined.delete(path);
  setPrompt(undefined);

  return trust({ path }).then((outcome) => {
    handleOpenOutcome(outcome);
    void queryClient.invalidateQueries({ queryKey: keys.workspaces });
    void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });

    return outcome.kind !== "failed";
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
  const router = useRouter();

  if (current === undefined) return null;
  const { path, origin } = current;

  const grant = (grantWith: NonNullable<typeof trust>): void => {
    void grantTrust(grantWith, path).then((granted) => {
      if (granted && origin === "open")
        void router.navigate({ to: "/", search: {}, replace: true });
    });
  };

  return (
    <Dialog.Root key={path} defaultOpen onOpenChange={(open) => !open && declineTrust(path)}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={styles.title}>
          {trust === undefined ? "This folder is not trusted" : "Trust Folder"}
        </Dialog.Title>
        <div {...props(styles.path)}>{path}</div>
        <Dialog.Description>
          {trust === undefined
            ? "This folder has plugins or skills of its own. Trust it on the machine running the server to load them."
            : "This folder has plugins or skills of its own. Trusting it loads them and lets Nyte run code and change files here."}
        </Dialog.Description>
        <Dialog.Footer>
          {trust === undefined ? (
            <Button onClick={() => declineTrust(path)}>Close</Button>
          ) : (
            <>
              <Button onClick={() => declineTrust(path)}>Cancel</Button>
              <Button variant="solid" tone="primary" onClick={() => grant(trust)}>
                Trust Folder
              </Button>
            </>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
