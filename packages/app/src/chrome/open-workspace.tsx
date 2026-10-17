import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Activation } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { keys, queryClient, useHostState } from "../queries.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../nyte.ts";
import type { HostBridge, OpenWorkspaceOutcome, TrustConsent } from "../bridge.ts";

const styles = create({
  popup: {
    gap: space.s3,
    width: "min(460px, calc(100vw - 48px))",
    padding: space.s5,
    borderStyle: "none",
  },
  title: { lineHeight: type.leadingBase },
  path: {
    padding: `${space.s1_5} ${space.s2_5}`,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

interface TrustPrompt {
  readonly path: string;
  readonly origin: "open" | "action";
  readonly consent?: TrustConsent;
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

export function requestTrust(path: string): void {
  if (declined.has(path)) return;
  toast.close("workspace-open");

  if (prompt?.path !== path) setPrompt({ path, origin: "action" });
}

/** Route a folder-open outcome to the shared dialog host. */
export function handleOpenOutcome(outcome: OpenWorkspaceOutcome): void {
  switch (outcome.kind) {
    case "needs_trust":
      toast.close("workspace-open");
      setPrompt({ path: outcome.path, origin: "open", consent: outcome.consent });

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

export function observeActivation(activation: Activation): void {
  if (activation.kind !== "unavailable") toast.close("workspace-unavailable");

  switch (activation.kind) {
    case "unavailable":
      toast.add({
        type: "error",
        title:
          activation.reason === "unreachable"
            ? "Couldn't reach this session's workspace"
            : "Can't open this session's workspace",
        id: "workspace-unavailable",
        timeout: 0,
      });

      return;
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

function reviewTrust(prompt: TrustPrompt): void {
  setPrompt(undefined);
  void nyte.host.openWorkspace({ path: prompt.path }).then((outcome) => {
    if (outcome.kind === "needs_trust" && outcome.consent !== undefined)
      setPrompt({ path: outcome.path, origin: prompt.origin, consent: outcome.consent });
    else handleOpenOutcome(outcome);
  });
}

function grantTrust(
  trust: NonNullable<HostBridge["trustWorkspace"]>,
  prompt: TrustPrompt,
): Promise<boolean> {
  const { path, consent } = prompt;
  declined.delete(path);
  setPrompt(undefined);

  return trust(consent === undefined ? { path } : { path, consent })
    .catch((cause: unknown): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }))
    .then((outcome) => {
      handleOpenOutcome(outcome);
      void queryClient.invalidateQueries({ queryKey: keys.workspaces });

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
  const host = useHostState();

  if (current === undefined) return null;
  const { path, origin, consent } = current;
  const binding = host.data.binding;
  const unseen = binding !== undefined && consent?.hostId !== binding.hostId;

  const grant = (grantWith: NonNullable<typeof trust>): void => {
    void grantTrust(grantWith, current).then((granted) => {
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
        {consent !== undefined && !unseen && (
          <>
            <div {...props(styles.path)}>Host {consent.hostId}</div>
            <div {...props(styles.path)}>Folder identity {consent.identity}</div>
          </>
        )}
        <Dialog.Description>
          {trust === undefined
            ? "This folder has its own skills, plugins or MCP servers. Trust it on the machine running the server to load them."
            : binding === undefined
              ? "This folder has its own skills, plugins or MCP servers. Trusting it loads them and lets Nyte run code and change files here."
              : "This folder has its own skills, plugins or MCP servers. Trusting it loads them and lets Nyte run code and change files there, on this host."}
        </Dialog.Description>
        <Dialog.Footer>
          {trust === undefined ? (
            <Button onClick={() => declineTrust(path)}>Close</Button>
          ) : (
            <>
              <Button onClick={() => declineTrust(path)}>Cancel</Button>
              {unseen ? (
                <Button variant="solid" tone="primary" onClick={() => reviewTrust(current)}>
                  Review Folder
                </Button>
              ) : (
                <Button variant="solid" tone="primary" onClick={() => grant(trust)}>
                  Trust Folder
                </Button>
              )}
            </>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
