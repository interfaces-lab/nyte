import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Activation, TrustSource, WorkspaceId, WorkspaceInfo } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace, trustWorkspace } from "../data/workspaces.ts";
import { errorMessage } from "../contract/errors.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../contract/nyte.ts";
import type { HostState } from "../contract/nyte.ts";
import type { HostBridge, OpenWorkspaceOutcome } from "../contract/bridge.ts";

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
    lineHeight: type.leadingCode,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

interface TrustPrompt {
  readonly path: string;
  readonly chat?: { readonly workspace: WorkspaceId; readonly parent: string | null };
}

let prompt: TrustPrompt | undefined;

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

export function handleOpenOutcome(outcome: OpenWorkspaceOutcome): void {
  switch (outcome.kind) {
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
      commitHostWorkspace(outcome.workspace);
      void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true });
      toast.close("workspace-open");
      setPrompt(outcome.needsTrust ? { path: outcome.workspace.path } : undefined);

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

export async function activateWorkspace(path: string | null): Promise<boolean> {
  const current = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path ?? null;

  if (path === current) return true;

  if (path === null) {
    commitHostWorkspace(undefined);

    return true;
  }

  const outcome = await nyte.host.openWorkspace({ path });
  handleOpenOutcome(outcome);

  return outcome.kind === "opened";
}

let failedShown = false;

const offered = new Set<WorkspaceId>();

export function observeTrust(workspace: Pick<WorkspaceInfo, "id" | "target" | "trust">): void {
  const { trust } = workspace;
  const notice = trust.state === "undecided" || trust.state === "untrusted" ? trust.notice : null;

  if (notice === null || offered.has(workspace.id)) return;
  offered.add(workspace.id);

  if (trust.state === "undecided") {
    setPrompt({
      path: "path" in workspace.target ? workspace.target.path : workspace.id,
      chat: { workspace: workspace.id, parent: trust.parent },
    });

    return;
  }

  if (trust.state !== "untrusted") return;
  const id = `workspace-trust-${workspace.id}`;

  toast.add({
    title: "This folder isn't trusted",
    description: `Its skills, plugins and MCP servers didn't load. ${untrustedReason(workspace.target, trust.by)}`,
    id,
    timeout: 0,
    actionProps: {
      children: "Trust Folder",
      onClick: () => {
        toast.close(id);
        void trustWorkspace(workspace.id).catch((cause: unknown) =>
          toast.add({
            type: "error",
            title: "Couldn't trust this folder",
            description: errorMessage(cause),
          }),
        );
      },
    },
  });
}

function untrustedReason(target: WorkspaceInfo["target"], by: TrustSource): string {
  if (by.kind === "setting") return "Project trust is set to never in Settings.";

  return by.path === null || ("path" in target && target.path === by.path)
    ? "You chose not to trust it."
    : `You chose not to trust ${by.path}.`;
}

export function observeActivation(activation: Activation): void {
  if (activation.kind !== "unavailable") toast.close("workspace-unavailable");

  switch (activation.kind) {
    case "inactive":
      return;
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
    default: {
      const _exhaustive: never = activation;

      return _exhaustive;
    }
  }
}

function declineTrust(): void {
  setPrompt(undefined);
}

function grantTrust(
  trust: NonNullable<HostBridge["trustWorkspace"]>,
  prompt: TrustPrompt,
): Promise<boolean> {
  setPrompt(undefined);

  return trust({ path: prompt.path }).then((outcome) => {
    handleOpenOutcome(outcome);
    void queryClient.invalidateQueries({ queryKey: keys.workspaces });

    return outcome.kind !== "failed";
  });
}

export function folderPicker(
  handle: (outcome: OpenWorkspaceOutcome) => void = handleOpenOutcome,
): (() => void) | undefined {
  const pick = nyte.host.pickWorkspace;

  return pick === undefined ? undefined : () => void pick().then(handle);
}

export function WorkspaceDialogHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, snapshot);
  const trust = nyte.host.trustWorkspace;
  const router = useRouter();

  if (current === undefined) return null;
  const path = current.path;

  if (current.chat !== undefined) return <ChatTrustDialog path={path} chat={current.chat} />;

  const grant = (grantWith: NonNullable<typeof trust>): void => {
    void grantTrust(grantWith, current).then((granted) => {
      if (granted) void router.navigate({ to: "/", search: {}, replace: true });
    });
  };

  return (
    <Dialog.Root key={path} defaultOpen onOpenChange={(open) => !open && declineTrust()}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={styles.title}>
          {trust === undefined ? "This folder is not trusted" : "Trust Folder"}
        </Dialog.Title>
        <div {...props(styles.path)}>{path}</div>
        <Dialog.Description>
          {trust === undefined
            ? "This folder has its own skills, plugins or MCP servers. Trust it on the machine running the server to load them."
            : "This folder has its own skills, plugins or MCP servers. Trusting it loads them and lets Nyte run code and change files here."}
        </Dialog.Description>
        <Dialog.Footer>
          {trust === undefined ? (
            <Button onClick={() => declineTrust()}>Close</Button>
          ) : (
            <>
              <Button onClick={() => declineTrust()}>Cancel</Button>
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

function ChatTrustDialog({
  path,
  chat,
}: {
  readonly path: string;
  readonly chat: NonNullable<TrustPrompt["chat"]>;
}): ReactElement {
  const decide = (at: "folder" | "parent"): void => {
    setPrompt(undefined);
    void trustWorkspace(chat.workspace, at).catch((cause: unknown) =>
      toast.add({
        type: "error",
        title: "Couldn't trust this folder",
        description: errorMessage(cause),
      }),
    );
  };

  return (
    <Dialog.Root key={path} defaultOpen onOpenChange={(open) => !open && declineTrust()}>
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={styles.title}>Trust Folder</Dialog.Title>
        <div {...props(styles.path)}>{path}</div>
        <Dialog.Description>
          This folder has its own skills, plugins or MCP servers. Trusting it loads them and lets
          Nyte run code and change files here.
        </Dialog.Description>
        <Dialog.Footer>
          <Button onClick={() => declineTrust()}>Not Now</Button>
          {chat.parent !== null && (
            <Button title={chat.parent} onClick={() => decide("parent")}>
              {`Trust ${chat.parent.split("/").findLast(Boolean) ?? chat.parent}`}
            </Button>
          )}
          <Button variant="solid" tone="primary" onClick={() => decide("folder")}>
            Trust Folder
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
