/** Where each window-tab place lives in the route, and back. */
import type { useRouter } from "@tanstack/react-router";
import { sessionId as sessionIdSchema } from "../schemas.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sameSelection } from "../layout/pane-layout.ts";
import { showsPage } from "./model.ts";
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

const pageSearch = Type.Object({
  customize: Type.Optional(Type.String()),
  environment: Type.Optional(Type.String()),
});

/** What the latest requested location shows; undefined while Settings covers the window. */
export function locationPlace(router: AppRouter): Place | undefined {
  const { pathname, search } = router.history.location;

  if (pathname.startsWith("/settings/")) return undefined;
  const params: unknown = router.options.parseSearch(search);
  const { customize, environment } = Value.Check(pageSearch, params) ? params : {};

  if (customize !== undefined)
    return { kind: "customize", section: customize, sessionId: undefined };

  if (environment !== undefined) return { kind: "environments", section: environment };
  const segment = /^\/session\/([^/]+)$/.exec(pathname)?.[1];

  if (segment === undefined) return pathname === "/" ? { kind: "blank" } : undefined;
  const session = decodeURIComponent(segment);

  return Value.Check(sessionIdSchema, session)
    ? { kind: "session", sessionId: session }
    : undefined;
}

export function samePlaceAt(place: Place, location: Place): boolean {
  if (showsPage(place) || showsPage(location)) {
    return (
      showsPage(place) &&
      showsPage(location) &&
      place.kind === location.kind &&
      pageSection(place) === pageSection(location)
    );
  }

  return sameSelection(place, location);
}

/** Move the route to a place; each move is a history entry, so the web's Back walks them. */
export function navigateTo(router: AppRouter, place: Place): void {
  switch (place.kind) {
    case "blank":
      void router.navigate({ to: "/", search: {} });

      return;
    case "session":
      void router.navigate({
        to: "/session/$sessionId",
        params: { sessionId: place.sessionId },
        search: {},
      });

      return;
    case "customize":
      void router.navigate({ to: "/", search: { customize: pageSection(place) } });

      return;
    case "environments":
      void router.navigate({ to: "/", search: { environment: pageSection(place) } });

      return;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}
