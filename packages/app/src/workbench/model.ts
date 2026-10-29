import type { JobId, PartId, SessionId, TurnId, WorkspaceId } from "@nyte-ai/sdk";
import type { IconName } from "@nyte-ai/ui/icon";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { DEFAULT_WIDTH, type WorkbenchWidth } from "./width.ts";

export type WorkbenchTabId = string;

export type WorkbenchViewKey = string;

export type WorkbenchChangesScope =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "thread" }
  | { readonly kind: "turn"; readonly turnId: TurnId }
  | { readonly kind: "commit"; readonly oid: string };

/** A terminal's process: a shell the user started, or an agent's job, which names its chat. */
export type TerminalOwner =
  | { readonly kind: "user" }
  | { readonly kind: "job"; readonly workspace: WorkspaceId; readonly job: JobId };

interface TabFields {
  readonly terminal: { readonly owner: TerminalOwner };
  readonly file: { readonly path: string; readonly preview: boolean };
  readonly changes: {
    readonly scope: WorkbenchChangesScope;
    readonly selectedPath: string | null;
    readonly pathRevealRevision: number;
    readonly scrollTop: number;
  };
  readonly browser: {
    readonly url: string;
    /** The agent's page this tab shows; `null` while the tab shows a page of its own. */
    readonly surface: string | null;
  };
  readonly canvas: {
    readonly sessionId: SessionId;
    readonly part: PartId;
    readonly title: string;
    /** The revision held in view while newer ones land; `null` follows the latest. */
    readonly pinned: number | null;
  };
  readonly files: Readonly<Record<never, never>>;
}

export type WorkbenchTabKind = keyof TabFields;

export type KindInput<Kind extends WorkbenchTabKind> = { readonly kind: Kind } & TabFields[Kind];

export type KindTab<Kind extends WorkbenchTabKind> = {
  readonly id: WorkbenchTabId;
} & KindInput<Kind>;

export type WorkbenchTabInput = { [Kind in WorkbenchTabKind]: KindInput<Kind> }[WorkbenchTabKind];

export type WorkbenchTab = { [Kind in WorkbenchTabKind]: KindTab<Kind> }[WorkbenchTabKind];

export type WorkbenchScope = { readonly kind: "pathless" } | { readonly kind: "project" };

/** The kinds a launcher opens; the rest open from what they show. */
export type LaunchKind = "files" | "changes" | "browser" | "terminal";

interface KindDescriptor<Kind extends WorkbenchTabKind> {
  readonly label: string;
  readonly icon: IconName;
  readonly available: (scope: WorkbenchScope, capabilities: ClientCapabilities) => boolean;
  /**
   * What a launcher opens: the one tab of a singleton kind, focused when it is open, or a new tab
   * every time. Absent for kinds that open from what they show (a file, a canvas).
   */
  readonly launch: Kind extends LaunchKind
    ? { readonly policy: "singleton" | "new"; readonly input: KindInput<Kind> }
    : undefined;
  /** Opening a tab whose identity matches an open tab's focuses that tab; `undefined` never matches. */
  readonly identity: (tab: KindInput<Kind>) => string | undefined;
}

const projectOnly = (scope: WorkbenchScope): boolean => scope.kind === "project";

const always = (): boolean => true;

/** One descriptor per tab kind; the rail, launchers, "+" menu and tab strip all read it. */
type WorkbenchKinds = { readonly [Kind in WorkbenchTabKind]: KindDescriptor<Kind> };

export const WORKBENCH_KINDS: WorkbenchKinds = {
  files: {
    label: "Files",
    icon: "file",
    available: projectOnly,
    launch: { policy: "singleton", input: { kind: "files" } },
    identity: () => "files",
  },
  changes: {
    label: "Changes",
    icon: "git-branch",
    available: projectOnly,
    launch: {
      policy: "singleton",
      input: {
        kind: "changes",
        scope: { kind: "uncommitted" },
        selectedPath: null,
        pathRevealRevision: 0,
        scrollTop: 0,
      },
    },
    identity: () => "changes",
  },
  browser: {
    label: "Browser",
    icon: "globe",
    available: (_scope, capabilities) => capabilities.browser,
    launch: { policy: "new", input: { kind: "browser", url: "about:blank", surface: null } },
    identity: (tab) => (tab.surface === null ? `url:${tab.url}` : `surface:${tab.surface}`),
  },
  terminal: {
    label: "Terminal",
    icon: "console",
    available: always,
    launch: { policy: "new", input: { kind: "terminal", owner: { kind: "user" } } },
    identity: (tab) =>
      tab.owner.kind === "job" ? `${tab.owner.workspace}:${tab.owner.job}` : undefined,
  },
  file: {
    label: "File",
    icon: "file",
    available: projectOnly,
    launch: undefined,
    identity: (tab) => tab.path,
  },
  canvas: {
    label: "Canvas",
    icon: "canvas-grid",
    available: always,
    launch: undefined,
    identity: (tab) => `${tab.sessionId}:${tab.part}`,
  },
};

/** The order every launcher lists its kinds in. */
const LAUNCH_ORDER = Object.freeze([
  "files",
  "changes",
  "browser",
  "terminal",
] satisfies LaunchKind[]);

export function workbenchLaunchers(
  scope: WorkbenchScope,
  capabilities: ClientCapabilities,
): readonly LaunchKind[] {
  return LAUNCH_ORDER.filter((kind) => WORKBENCH_KINDS[kind].available(scope, capabilities));
}

export function workbenchTabAvailable(
  scope: WorkbenchScope,
  kind: WorkbenchTabKind,
  capabilities: ClientCapabilities,
): boolean {
  return WORKBENCH_KINDS[kind].available(scope, capabilities);
}

export function tabIdentity<Kind extends WorkbenchTabKind>(
  tab: KindInput<Kind>,
): string | undefined {
  return WORKBENCH_KINDS[tab.kind].identity(tab);
}

/** The open tab that `input` names, by its kind's identity. */
export function matchingTab(
  tabs: readonly WorkbenchTab[],
  input: WorkbenchTabInput,
): WorkbenchTab | undefined {
  const identity = tabIdentity(input);

  if (identity === undefined) return undefined;

  return tabs.find((tab) => tab.kind === input.kind && tabIdentity(tab) === identity);
}

export function workbenchTabLabel(tab: WorkbenchTab): string {
  if (tab.kind === "file") return tab.path.split(/[\\/]/).at(-1) ?? tab.path;

  if (tab.kind === "canvas") return tab.title;

  return WORKBENCH_KINDS[tab.kind].label;
}

/** The native page a Browser tab shows: the agent's it took over, else its own. */
export function browserSurface(tab: KindTab<"browser">): string {
  return tab.surface ?? tab.id;
}

export function changesScopeValue(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
    case "thread":
      return scope.kind;
    case "turn":
      return `turn:${scope.turnId}`;
    case "commit":
      return `commit:${scope.oid}`;
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
  }
}

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

/** The panel slot every file and the Files tab share. */
export const FILES_SLOT = "files";

export function workbenchShowsChat(layout: WorkbenchLayout): boolean {
  return layout.kind === "maximized" && layout.showing === "chat";
}

export function revealWorkbench(layout: WorkbenchLayout): WorkbenchLayout {
  return workbenchShowsChat(layout) ? MAXIMIZED_WORKBENCH_LAYOUT : layout;
}

export interface WorkbenchViewState {
  readonly tabs: readonly WorkbenchTab[];
  readonly active: WorkbenchTabId | null;
  readonly expanded: boolean;
  readonly collapsed: "floating" | "compact";
  readonly layout: WorkbenchLayout;
  readonly width: WorkbenchWidth;
  /** The panel slots, a tab's id or {@link FILES_SLOT}, whose sidebar is showing. */
  readonly sidebars: readonly string[];
}

export interface WorkbenchSnapshot {
  readonly views: ReadonlyMap<WorkbenchViewKey, WorkbenchViewState>;
}

export const DEFAULT_VIEW = Object.freeze({
  tabs: Object.freeze([]),
  active: null,
  expanded: false,
  collapsed: "floating",
  layout: SPLIT_LAYOUT,
  width: DEFAULT_WIDTH,
  sidebars: Object.freeze([]),
}) satisfies WorkbenchViewState;

/** The panel slot a tab renders in. */
export function tabSlot(tab: WorkbenchTab): string {
  return tab.kind === "file" || tab.kind === "files" ? FILES_SLOT : tab.id;
}
