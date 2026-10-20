import type { RegisteredRouter } from "@tanstack/react-router";
import { placeHref } from "../tabs/places.ts";

let workspaceHref = "/";

export function rememberWorkspaceHref(href: string): void {
  workspaceHref = href;
}

export function closeSettings(router: RegisteredRouter): void {
  void router.navigate({ href: workspaceHref, replace: true });
}

export function openEnvironmentsFromSettings(router: RegisteredRouter): void {
  void router.navigate({
    href: placeHref({ kind: "environments", section: undefined }),
    replace: true,
  });
}
