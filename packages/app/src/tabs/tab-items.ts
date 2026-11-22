import type { IconName } from "@nyte-ai/ui/icon";
import { taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { ProjectInfo, SessionId } from "@nyte-ai/sdk";
import { chatTitle, NEW_CHAT_TITLE } from "../chats/index.ts";
import type { ChatDirectory } from "../chats/index.ts";
import { tabPlace, tabPlaces } from "./model.ts";
import type { Place, Tab, WindowState } from "./model.ts";
import type { ChatMark } from "../window/index.ts";

const PLACE_ICONS = {
  blank: "new-chat",
  session: "new-chat",
  customize: "customize",
  project: "layers",
} satisfies Record<Place["kind"], IconName>;

export type WindowTabSplit = "right" | "down";

export interface WindowTabItem {
  readonly id: string;
  readonly title: string;
  readonly tooltip: string;
  readonly sessions: readonly SessionId[];
  readonly parent?: SessionId;
  readonly chat: SessionId | undefined;
  readonly glyph: IconName | undefined;
  readonly preview: boolean;
  readonly split: WindowTabSplit | undefined;
}

export function windowTabItems(
  state: WindowState,
  chats: ChatDirectory,
  projects: readonly ProjectInfo[],
  previous: readonly WindowTabItem[],
): readonly WindowTabItem[] {
  const items = state.tabs.map((tab) => {
    const item = tabItem(tab, chats, projects);
    const kept = previous.find((entry) => entry.id === item.id);

    return kept !== undefined &&
      kept.title === item.title &&
      kept.tooltip === item.tooltip &&
      kept.sessions.length === item.sessions.length &&
      kept.sessions.every((session, index) => session === item.sessions[index]) &&
      kept.parent === item.parent &&
      kept.chat === item.chat &&
      kept.glyph === item.glyph &&
      kept.preview === item.preview &&
      kept.split === item.split
      ? kept
      : item;
  });

  return items.length === previous.length && items.every((item, index) => item === previous[index])
    ? previous
    : items;
}

function tabItem(tab: Tab, chats: ChatDirectory, projects: readonly ProjectInfo[]): WindowTabItem {
  const places = tabPlaces(tab);
  const place = tabPlace(tab);
  const view = tab.view;
  const chat = place.kind === "session" ? chats.get(place.sessionId) : undefined;

  return {
    id: tab.id,
    title: placeTitle(place, chats, projects),
    tooltip: places.map((candidate) => placeTitle(candidate, chats, projects)).join(" | "),
    sessions: places.flatMap((candidate) =>
      candidate.kind === "session" ? [candidate.sessionId] : [],
    ),
    parent: chat?.parent ?? undefined,
    chat: place.kind === "session" ? place.sessionId : undefined,
    glyph: PLACE_ICONS[place.kind],
    preview: view.kind === "preview",
    split:
      view.kind === "panes" && view.layout.root.kind === "split"
        ? view.layout.root.direction
        : undefined,
  };
}

function placeTitle(place: Place, chats: ChatDirectory, projects: readonly ProjectInfo[]): string {
  switch (place.kind) {
    case "blank":
      return NEW_CHAT_TITLE;
    case "session":
      return chatTitle(chats.get(place.sessionId));
    case "customize":
      return "Customize";
    case "project":
      return projects.find((project) => project.id === place.projectId)?.name ?? "Project";
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

export function tabName(
  tab: Pick<WindowTabItem, "tooltip" | "preview">,
  mark: ChatMark | undefined,
): string {
  return [
    tab.tooltip,
    ...(mark === undefined || mark.state === "done" ? [] : [taskLabel(mark.state).toLowerCase()]),
    ...(mark?.unread === true ? ["unread"] : []),
    ...(tab.preview ? ["preview"] : []),
  ].join(", ");
}
