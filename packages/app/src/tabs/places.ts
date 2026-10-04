/** Where each window-tab place lives in the route, and back. */
import type { useRouter } from "@tanstack/react-router";
import { schemas } from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import { sameSelection } from "../layout/pane-layout.ts";
import { isPage } from "./model.ts";
import type { Page, Place } from "./model.ts";

/** The section a page opens on when it has not been moved. */
export function pageSection(page: Page): string {
  return page.section ?? (page.kind === "customize" ? "plugins" : "connections");
}

/** The address a place has, for the window's first route before the router runs. */
export function placeHref(place: Place): string {
  switch (place.kind) {
    case "blank":
      return "/";
    case "session":
      return `/session/${encodeURIComponent(place.sessionId)}`;
    case "customize":
      return `/?customize=${encodeURIComponent(pageSection(place))}`;
    case "environments":
      return `/?environment=${encodeURIComponent(pageSection(place))}`;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

type AppRouter = ReturnType<typeof useRouter>;

/** What the latest requested location shows; undefined while Settings covers the window. */
export function locationPlace(router: AppRouter): Place | undefined {
  const { pathname, search } = router.history.location;

  if (pathname.startsWith("/settings/")) return undefined;
  const params = router.options.parseSearch(search);
  const customize = params.customize;
  const environment = params.environment;

  if (typeof customize === "string")
    return { kind: "customize", section: customize, sessionId: undefined };

  if (typeof environment === "string") return { kind: "environments", section: environment };
  const segment = /^\/session\/([^/]+)$/.exec(pathname)?.[1];

  if (segment === undefined) return pathname === "/" ? { kind: "blank" } : undefined;
  const session = decodeURIComponent(segment);

  return Value.Check(schemas.SessionId, session)
    ? { kind: "session", sessionId: session }
    : undefined;
}

export function samePlaceAt(place: Place, location: Place): boolean {
  if (isPage(place) || isPage(location)) {
    return (
      isPage(place) &&
      isPage(location) &&
      place.kind === location.kind &&
      pageSection(place) === pageSection(location)
    );
  }

  return sameSelection(place, location);
}

export function navigateTo(router: AppRouter, place: Place): void {
  switch (place.kind) {
    case "blank":
      void router.navigate({ to: "/", search: {}, replace: true });

      return;
    case "session":
      void router.navigate({
        to: "/session/$sessionId",
        params: { sessionId: place.sessionId },
        search: {},
        replace: true,
      });

      return;
    case "customize":
      void router.navigate({ to: "/", search: { customize: pageSection(place) }, replace: true });

      return;
    case "environments":
      void router.navigate({ to: "/", search: { environment: pageSection(place) }, replace: true });

      return;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** Whether the route already shows `selection`, so a route sync is not a stale one. */
export function routeShows(router: AppRouter, selection: Place): boolean {
  const location = locationPlace(router);

  return location !== undefined && samePlaceAt(selection, location);
}
