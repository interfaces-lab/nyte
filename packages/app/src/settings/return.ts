import type { RegisteredRouter } from "@tanstack/react-router";
import type { SessionId } from "@nyte-ai/sdk";
import { activeTab, tabPlace } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";
import { placeHref } from "../tabs/places.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

const SETTINGS_ROUTE = "/settings/$section";

let windowRouter: RegisteredRouter | undefined;

/** Hands over the window's router, so a chat opened from outside the window can close Settings. */
export function routeSettings(router: RegisteredRouter): void {
  windowRouter = router;
}

/**
 * Where closing Settings goes: the window's active tab, which a notification may have changed
 * while Settings was open, not the place Settings was opened from.
 */
export function settingsReturn(state: WindowState): string {
  return placeHref(tabPlace(activeTab(state)));
}

export function closeSettings(router: RegisteredRouter): void {
  void router.navigate({ href: settingsReturn(windowTabs.getSnapshot()), replace: true });
}

/**
 * A notification's chat, which the person asked to see: its tab opens, and Settings closes over
 * it, as following a link to the chat does.
 */
export function showNotifiedChat(sessionId: SessionId): void {
  windowTabs.openChat(sessionId, "permanent");
  const router = windowRouter;

  if (router?.state.matches.some((match) => match.routeId === SETTINGS_ROUTE) === true)
    closeSettings(router);
}
