import type { RegisteredRouter } from "@tanstack/react-router";
import type { SessionId } from "@nyte-ai/sdk";
import { activeTab, tabPlace } from "../tabs/model.ts";
import type { WindowState } from "../tabs/model.ts";
import { placeHref } from "../tabs/places.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

const SETTINGS_ROUTE = "/settings/$section";

let windowRouter: RegisteredRouter | undefined;

export function routeSettings(router: RegisteredRouter): void {
  windowRouter = router;
}

function settingsReturn(state: WindowState): string {
  return placeHref(tabPlace(activeTab(state)));
}

export function closeSettings(router: RegisteredRouter): void {
  void router.navigate({ href: settingsReturn(windowTabs.getSnapshot()), replace: true });
}

export function showNotifiedChat(sessionId: SessionId): void {
  windowTabs.openChat(sessionId, "permanent");
  const router = windowRouter;

  if (router?.state.matches.some((match) => match.routeId === SETTINGS_ROUTE) === true) {
    closeSettings(router);
  }
}
