import type { SessionId } from "@nyte-ai/sdk";
import type { HostState, SelectedWorkspace } from "../contract/bridge.ts";
import { activeTab, tabPlace } from "./model.ts";
import type { Place, Tab, WindowAction, WindowState } from "./model.ts";
import { pageSection, samePlaceAt } from "./places.ts";

/** The tab and chat the window last followed, and the folder it asked the host for last. */
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

/** The window's workspace as the page holds it, and whether the page chose it rather than remembering it from the last launch. */
export interface ShownFolder {
  readonly workspace: SelectedWorkspace | undefined;
  readonly chosen: boolean;
}

/**
 * What a window reopening on a chat shows once the host answers the chat's folder, `restored`, or
 * undefined to keep what it shows. A window that showed a folder of its own when it asked, as one
 * Finder opened does, keeps it, and so does one whose folder changed while the host answered, as
 * when someone picked a folder meanwhile.
 */
export function restoredFolder(
  asked: ShownFolder,
  now: ShownFolder,
  restored: SelectedWorkspace | undefined,
): HostState | undefined {
  if (asked.chosen || now.workspace !== asked.workspace) return undefined;

  return { workspace: restored };
}

/**
 * The place to navigate to so the URL shows the active tab, or undefined when it already does or
 * the location is outside the tabs, as Settings is.
 */
export function routeFor(state: WindowState, location: Place | undefined): Place | undefined {
  const place = tabPlace(activeTab(state));

  return location === undefined || samePlaceAt(place, location) ? undefined : place;
}

/**
 * The action that makes the active tab show `location`: a customize tab changes section, any other
 * tab opens the place for good.
 */
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

/**
 * Whether showing `tab` asks the host for its chat's folder. A chat whose folder is not known yet
 * is not remembered, so it is followed again once the chats load.
 */
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
