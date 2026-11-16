import type { SessionId, WorkspaceInfo } from "@nyte-ai/sdk";
import type { HostState, OpenWorkspaceOutcome, SelectedWorkspace } from "../contract/bridge.ts";
import { activeTab, tabPlace } from "./model.ts";
import type { Place, Tab, WindowAction, WindowState } from "./model.ts";
import { pageSection, samePlaceAt } from "./places.ts";

export interface FolderFollow {
  readonly followed: string;
  readonly wanted: string | null;
}

export type FollowStep =
  | { readonly kind: "none" }
  | { readonly kind: "activate"; readonly folder: string | null };

export interface FolderFollowed {
  readonly next: FolderFollow;
  readonly step: FollowStep;
}

export interface ShownFolder {
  readonly workspace: SelectedWorkspace | undefined;
  readonly chosen: boolean;
}

export function restoredFolder(
  asked: ShownFolder,
  now: ShownFolder,
  restored: SelectedWorkspace | undefined,
): HostState | undefined {
  if (asked.chosen || now.workspace !== asked.workspace) return undefined;

  return { workspace: restored };
}

export function unreadableFolder(
  shown: SelectedWorkspace | undefined,
  workspaces: readonly WorkspaceInfo[] | undefined,
): SelectedWorkspace | undefined {
  const listed = workspaces?.find((workspace) => workspace.id === shown?.id);

  return listed?.availability.kind === "unavailable" ? shown : undefined;
}

export function checkedFolder(
  asked: SelectedWorkspace,
  now: SelectedWorkspace | undefined,
  outcome: OpenWorkspaceOutcome,
): HostState | undefined {
  if (now?.path !== asked.path) return undefined;

  if (outcome.kind === "failed") return { workspace: undefined };

  return outcome.kind === "opened" && outcome.workspace.id !== asked.id
    ? { workspace: outcome.workspace }
    : undefined;
}

export function routeFor(state: WindowState, location: Place | undefined): Place | undefined {
  const place = tabPlace(activeTab(state));

  return location === undefined || samePlaceAt(place, location) ? undefined : place;
}

export function adoptLocation(
  state: WindowState,
  location: Place | undefined,
): WindowAction | undefined {
  if (location === undefined) return undefined;
  const tab = activeTab(state);
  const view = tab.view;

  if (view.kind === "page" && view.page.kind === "customize" && location.kind === "customize")
    return pageSection(view.page) === pageSection(location)
      ? undefined
      : { kind: "page-section", section: pageSection(location) };

  return samePlaceAt(tabPlace(tab), location)
    ? undefined
    : { kind: "open", place: location, target: "permanent" };
}

export function followFolder(
  previous: FolderFollow,
  tab: Tab,
  folder: (id: SessionId) => string | null | undefined,
): FolderFollowed {
  const place = tabPlace(tab);
  const followed = `${tab.id}:${place.kind === "session" ? place.sessionId : place.kind}`;

  if (followed === previous.followed) return { next: previous, step: { kind: "none" } };

  if (place.kind !== "session") return { next: { ...previous, followed }, step: { kind: "none" } };
  const wanted = folder(place.sessionId);

  if (wanted === undefined) return { next: previous, step: { kind: "none" } };

  return { next: { followed, wanted }, step: { kind: "activate", folder: wanted } };
}
