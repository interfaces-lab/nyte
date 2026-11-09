import type { useRouter } from "@tanstack/react-router";
import { projectId as projectIdSchema, sessionId as sessionIdSchema } from "../data/schemas.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sameSelection } from "../panes/pane-layout.ts";
import type { CustomizePage, Place } from "./model.ts";

export function pageSection(page: CustomizePage): string {
  return page.section ?? "plugins";
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
      return `/project/${encodeURIComponent(place.projectId)}`;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

type AppRouter = ReturnType<typeof useRouter>;

const pageSearch = Type.Object({
  customize: Type.Optional(Type.String()),
});

export function locationPlace(router: AppRouter): Place | undefined {
  const { pathname, search } = router.history.location;

  if (pathname.startsWith("/settings/")) return undefined;
  const params: unknown = router.options.parseSearch(search);
  const { customize } = Value.Check(pageSearch, params) ? params : {};

  if (customize !== undefined)
    return { kind: "customize", section: customize, sessionId: undefined };

  const project = /^\/project\/([^/]+)$/.exec(pathname)?.[1];

  if (project !== undefined) {
    const id = decodeURIComponent(project);

    return Value.Check(projectIdSchema, id) ? { kind: "project", projectId: id } : undefined;
  }

  const segment = /^\/session\/([^/]+)$/.exec(pathname)?.[1];

  if (segment === undefined) return pathname === "/" ? { kind: "blank" } : undefined;
  const session = decodeURIComponent(segment);

  return Value.Check(sessionIdSchema, session)
    ? { kind: "session", sessionId: session }
    : undefined;
}

export function samePlaceAt(place: Place, location: Place): boolean {
  if (place.kind === "customize" || location.kind === "customize")
    return (
      place.kind === "customize" &&
      location.kind === "customize" &&
      pageSection(place) === pageSection(location)
    );

  if (place.kind === "project" || location.kind === "project")
    return (
      place.kind === "project" &&
      location.kind === "project" &&
      place.projectId === location.projectId
    );

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
      void router.navigate({
        to: "/project/$projectId",
        params: { projectId: place.projectId },
        search: {},
      });

      return;
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}
