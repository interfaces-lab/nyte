import type { PartId, SessionId } from "@nyte-ai/sdk";
import type { TurnId } from "@nyte-ai/sdk";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { DEFAULT_WIDTH, type WorkbenchWidth } from "./width.ts";

export type WorkbenchTabId = string;

export type WorkbenchViewKey = string;

export type WorkbenchTabKind = WorkbenchTab["kind"];

export type WorkbenchChangesScope =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "thread" }
  | { readonly kind: "turn"; readonly turnId: TurnId }
  | { readonly kind: "commit"; readonly oid: string };

export type TerminalOwner =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly sessionId: SessionId; readonly jobId: string };

export type WorkbenchTab =
  | { readonly id: WorkbenchTabId; readonly kind: "terminal"; readonly owner: TerminalOwner }
  | {
      readonly id: WorkbenchTabId;
      readonly kind: "file";
      readonly path: string;
      readonly preview: boolean;
    }
  | {
      readonly id: WorkbenchTabId;
      readonly kind: "changes";
      readonly scope: WorkbenchChangesScope;
      readonly selectedPath: string | null;
      readonly pathRevealRevision: number;
      readonly scrollTop: number;
    }
  | { readonly id: WorkbenchTabId; readonly kind: "browser"; readonly url: string }
  | {
      readonly id: WorkbenchTabId;
      readonly kind: "canvas";
      readonly sessionId: SessionId;
      readonly part: PartId;
      readonly title: string;
      /** The revision held in view while newer ones land; `null` follows the latest. */
      readonly pinned: number | null;
    }
  | { readonly id: WorkbenchTabId; readonly kind: "files" };

export type WorkbenchTabInput = WorkbenchTab extends infer Tab
  ? Tab extends WorkbenchTab
    ? Omit<Tab, "id">
    : never
  : never;

export type WorkbenchLayout =
  | { readonly kind: "split" }
  | { readonly kind: "maximized"; readonly showing: "workbench" | "chat" };

export const SPLIT_LAYOUT = Object.freeze({ kind: "split" }) satisfies WorkbenchLayout;

export const MAXIMIZED_WORKBENCH_LAYOUT = Object.freeze({
  kind: "maximized",
  showing: "workbench",
}) satisfies WorkbenchLayout;

export const MAXIMIZED_CHAT_LAYOUT = Object.freeze({
  kind: "maximized",
  showing: "chat",
}) satisfies WorkbenchLayout;

export const WORKBENCH_CHAT_TAB = "chat";

export function workbenchShowsChat(layout: WorkbenchLayout): boolean {
  return layout.kind === "maximized" && layout.showing === "chat";
}

export function revealWorkbench(layout: WorkbenchLayout): WorkbenchLayout {
  return workbenchShowsChat(layout) ? MAXIMIZED_WORKBENCH_LAYOUT : layout;
}

export function sameChangesScope(
  left: WorkbenchChangesScope,
  right: WorkbenchChangesScope,
): boolean {
  switch (left.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
    case "thread":
      return right.kind === left.kind;
    case "turn":
      return right.kind === "turn" && right.turnId === left.turnId;
    case "commit":
      return right.kind === "commit" && right.oid === left.oid;
    default: {
      const _exhaustive: never = left;

      return _exhaustive;
    }
  }
}

export type WorkbenchScope = { readonly kind: "pathless" } | { readonly kind: "project" };

export const WORKBENCH_HOME_VIEW_KEY: WorkbenchViewKey = "home";

export function workbenchViewKey(workspacePath: string | undefined): WorkbenchViewKey {
  return workspacePath ?? WORKBENCH_HOME_VIEW_KEY;
}

export function workbenchScope(workspacePath: string | undefined): WorkbenchScope {
  return workspacePath === undefined ? { kind: "pathless" } : { kind: "project" };
}

const PATHLESS_TABS = Object.freeze(["browser", "terminal"] satisfies WorkbenchTabKind[]);

const PROJECT_TABS = Object.freeze([
  "files",
  "changes",
  "browser",
  "terminal",
] satisfies WorkbenchTabKind[]);

export function workbenchTabs(
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): readonly WorkbenchTabKind[] {
  let tabs: readonly WorkbenchTabKind[];

  switch (scope.kind) {
    case "pathless":
      tabs = PATHLESS_TABS;
      break;
    case "project":
      tabs = PROJECT_TABS;
      break;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }

  return tabs.filter((kind) => workbenchTabAvailable(scope, kind, capabilities));
}

export function workbenchTabAvailable(
  scope: WorkbenchScope,
  kind: WorkbenchTabKind,
  capabilities: ClientCapabilities,
): boolean {
  switch (kind) {
    case "browser":
      return capabilities.browser;
    case "terminal":
    case "canvas":
      return true;
    case "file":
    case "files":
    case "changes":
      return scope.kind === "project";
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}

export interface WorkbenchViewState {
  readonly tabs: readonly WorkbenchTab[];
  readonly active: WorkbenchTabId | null;
  readonly expanded: boolean;
  readonly collapsed: "floating" | "compact";
  readonly layout: WorkbenchLayout;
  readonly width: WorkbenchWidth;
}

export interface WorkbenchSnapshot {
  readonly views: ReadonlyMap<WorkbenchViewKey, WorkbenchViewState>;
}

type ChangesPatch = Omit<Extract<WorkbenchTab, { readonly kind: "changes" }>, "id" | "kind">;

type FilePatch = Omit<Extract<WorkbenchTab, { readonly kind: "file" }>, "id" | "kind" | "path">;

type BrowserPatch = Omit<Extract<WorkbenchTab, { readonly kind: "browser" }>, "id" | "kind">;

type CanvasPatch = Partial<
  Pick<Extract<WorkbenchTab, { readonly kind: "canvas" }>, "title" | "pinned">
>;

export type WorkbenchTabUpdate =
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "changes";
      readonly patch: ChangesPatch;
    }
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "file";
      readonly patch: FilePatch;
    }
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "browser";
      readonly patch: BrowserPatch;
    }
  | {
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly kind: "canvas";
      readonly patch: CanvasPatch;
    };

export const DEFAULT_VIEW = Object.freeze({
  tabs: Object.freeze([]),
  active: null,
  expanded: false,
  collapsed: "floating",
  layout: SPLIT_LAYOUT,
  width: DEFAULT_WIDTH,
}) satisfies WorkbenchViewState;

export function activeWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): WorkbenchTab | null {
  const active = view.tabs.find((tab) => tab.id === view.active);

  if (active !== undefined && workbenchTabAvailable(scope, active.kind, capabilities))
    return active;

  return view.tabs.find((tab) => workbenchTabAvailable(scope, tab.kind, capabilities)) ?? null;
}

/** The tab on screen: none while the workbench is collapsed or the maximized chat covers it. */
export function shownWorkbenchTab(
  view: WorkbenchViewState,
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): WorkbenchTab | null {
  if (!view.expanded || workbenchShowsChat(view.layout)) return null;

  return activeWorkbenchTab(view, scope, capabilities);
}

export function workbenchTabLabel(tab: WorkbenchTab): string {
  if (tab.kind === "file") return tab.path.split(/[\\/]/).at(-1) ?? tab.path;

  if (tab.kind === "canvas") return tab.title;

  return workbenchKindLabel(tab.kind);
}

export function workbenchKindLabel(kind: WorkbenchTabKind): string {
  switch (kind) {
    case "file":
      return "File";
    case "files":
      return "Files";
    case "changes":
      return "Changes";
    case "browser":
      return "Browser";
    case "canvas":
      return "Canvas";
    case "terminal":
      return "Terminal";
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}

export function defaultWorkbenchTab(kind: WorkbenchTabKind): WorkbenchTabInput {
  switch (kind) {
    case "files":
      return { kind: "files" };
    case "changes":
      return {
        kind: "changes",
        scope: { kind: "uncommitted" },
        selectedPath: null,
        pathRevealRevision: 0,
        scrollTop: 0,
      };
    case "browser":
      return { kind: "browser", url: "about:blank" };
    case "terminal":
      return { kind: "terminal", owner: { kind: "user" } };
    case "file":
      throw new Error("A file tab requires a path");
    case "canvas":
      throw new Error("A canvas tab requires a canvas");
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}
