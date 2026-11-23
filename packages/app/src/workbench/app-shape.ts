import type { ClientCapabilities } from "../contract/client-actions.ts";
import type { DesktopApp } from "../contract/desktop-app.ts";
import { windowApp } from "../contract/nyte.ts";
import { DEFAULT_VIEW, EDITOR_SLOT, WORKBENCH_KINDS } from "./model.ts";
import type { LaunchKind, WorkbenchScope, WorkbenchViewState } from "./model.ts";
import { reduceView } from "./view-reducer.ts";
import type { WorkbenchViewAction } from "./view-reducer.ts";

/** What makes one of Nyte's apps the window it is. Everything that differs between the apps is a field here. */
export interface AppShape {
  /** What the sidebar toggle shows: the chat list beside the stage, or the Editor's file explorer. */
  readonly navigator: "chats" | "files";
  /** The side panel. The other region is the window's main area, which never closes. */
  readonly panel: "workbench" | "chat";
  /** Whether chats open as tabs along the title bar. */
  readonly windowTabs: boolean;
  /** The workbench tabs the app offers, in menu order. An app without an Editor opens files in Code. */
  readonly launchers: readonly LaunchKind[];
  /** How the workbench is arranged for a project the app hasn't shown yet. */
  readonly initial: WorkbenchViewState;
  /** Where a selection made in another window lands: nowhere, in the Editor at its range, or on the Design board. */
  readonly arrival: "ignore" | "file" | "design";
  readonly surface: "glass" | "solid";
}

const LAUNCH_ORDER = Object.freeze([
  "editor",
  "changes",
  "design",
  "browser",
  "terminal",
] satisfies LaunchKind[]);

const CODE_CHAT_WIDTH = 440;

function arrange(actions: readonly WorkbenchViewAction[]): WorkbenchViewState {
  return Object.freeze(actions.reduce(reduceView, DEFAULT_VIEW));
}

const APP_SHAPES = {
  nyte: {
    navigator: "chats",
    panel: "workbench",
    windowTabs: true,
    launchers: LAUNCH_ORDER,
    initial: DEFAULT_VIEW,
    arrival: "ignore",
    surface: "glass",
  },
  code: {
    navigator: "files",
    panel: "chat",
    windowTabs: false,
    launchers: ["editor", "changes", "browser", "terminal"],
    initial: arrange([
      { kind: "open", tab: { id: "editor", kind: "editor" }, activate: true },
      { kind: "toggle-sidebar", slot: EDITOR_SLOT },
      { kind: "set-width", pixels: CODE_CHAT_WIDTH },
    ]),
    arrival: "file",
    surface: "solid",
  },
  studio: {
    navigator: "chats",
    panel: "workbench",
    windowTabs: true,
    launchers: ["design"],
    initial: arrange([
      { kind: "open", tab: { id: "design", kind: "design" }, activate: true },
      { kind: "maximize" },
    ]),
    arrival: "design",
    surface: "glass",
  },
} as const satisfies Readonly<Record<DesktopApp, AppShape>>;

/** The shape of the app this window is. */
export function appShape(): AppShape {
  return APP_SHAPES[windowApp()];
}

export function workbenchLaunchers(
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): readonly LaunchKind[] {
  const offered = appShape().launchers;

  return LAUNCH_ORDER.filter(
    (kind) => offered.includes(kind) && WORKBENCH_KINDS[kind].available(scope, capabilities),
  );
}
