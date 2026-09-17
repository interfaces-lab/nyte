import type {
  ServerInfo,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
} from "@nyte-ai/protocol";

export type WorkspaceMenu =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      items: readonly WorkspaceInfo[];
      selection: WorkspaceSelection;
      switching?: WorkspaceSelectInput;
    };

export function workspaceMenuAvailable(info: ServerInfo): boolean {
  return info.host.kind === "described" && info.host.capabilities.workspace;
}

export function listedWorkspaces(items: readonly WorkspaceInfo[]): readonly WorkspaceInfo[] {
  return items.filter((item) => item.available !== false);
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

export function sameSelectInput(
  left: WorkspaceSelectInput,
  right: WorkspaceSelectInput,
): boolean {
  if (left.kind === "home") return right.kind === "home";
  return right.kind === "project" && left.path === right.path;
}

export function applyWorkspaceSelect(
  menu: Extract<WorkspaceMenu, { kind: "ready" }>,
  outcome: WorkspaceSelectOutcome,
): {
  readonly menu: Extract<WorkspaceMenu, { kind: "ready" }>;
  readonly caption: string | undefined;
} {
  return {
    menu: {
      kind: "ready",
      items: menu.items,
      selection: outcome.kind === "opened" ? outcome.selection : menu.selection,
    },
    caption: workspaceSelectCaption(outcome),
  };
}
