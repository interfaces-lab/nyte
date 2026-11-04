import type { useRouter } from "@tanstack/react-router";
import { sessionId as sessionIdSchema } from "../data/schemas.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sameSelection } from "../panes/pane-layout.ts";
import { showsPage } from "./model.ts";
import type { Page, Place } from "./model.ts";

export function pageSection(page: Page): string {
  return page.section ?? (page.kind === "customize" ? "plugins" : "new");
}

export function placeHref(place: Place): string {
  switch (place.kind) {
    case "blank":
      return "/";
    case "session":
      return `/session/${encodeURIComponent(place.sessionId)}`;
    case "customize":
      return `/?customize=${encodeURIComponent(pageSection(place))}`;
    case "project":
      return `/?project=${encodeURIComponent(pageSection(place))}`;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

type AppRouter = ReturnType<typeof useRouter>;

const pageSearch = Type.Object({
  customize: Type.Optional(Type.String()),
  project: Type.Optional(Type.String()),
});

export function locationPlace(router: AppRouter): Place | undefined {
  const { pathname, search } = router.history.location;

  if (pathname.startsWith("/settings/")) return undefined;
  const params: unknown = router.options.parseSearch(search);
  const { customize, project } = Value.Check(pageSearch, params) ? params : {};

  if (customize !== undefined)
    return { kind: "customize", section: customize, sessionId: undefined };

  if (project !== undefined) return { kind: "project", section: project, sessionId: undefined };

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
    case "project":
      void router.navigate({ to: "/", search: { project: pageSection(place) } });

      return;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}
