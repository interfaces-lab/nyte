import type {
  ServerInfo,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
} from "@nyte-ai/protocol";

export type WorkspaceMenu =
  | { kind: "hidden" }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      items: readonly WorkspaceInfo[];
      selection: WorkspaceSelection;
    };

export function workspaceMenuAvailable(info: ServerInfo): boolean {
  return info.host.kind === "described" && info.host.capabilities.workspace;
}

export function listedWorkspaces(items: readonly WorkspaceInfo[]): readonly WorkspaceInfo[] {
  // The host refuses anything but an explicit true; list only what it can open.
  return items.filter((item) => item.available === true);
}

export function workspaceChipLabel(selection: WorkspaceSelection): string {
  return selection.kind === "home" ? "Home" : selection.workspace.name;
}

export function workspaceSelectCaption(outcome: WorkspaceSelectOutcome): string | undefined {
  switch (outcome.kind) {
    case "opened":
      return undefined;
    case "untrusted":
      return "Trust this folder on your Mac, then pick it again.";
    case "unavailable":
      return "That folder isn't available on your Mac.";
    case "failed":
      return outcome.message;
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

export function selectionMatches(
  selection: WorkspaceSelection,
  input: WorkspaceSelectInput,
): boolean {
  if (input.kind === "home") return selection.kind === "home";

  return selection.kind === "project" && selection.workspace.path === input.path;
}
