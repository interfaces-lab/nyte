import type { RegisteredRouter } from "@tanstack/react-router";

let workspaceHref = "/";

export function rememberWorkspaceHref(href: string): void {
  workspaceHref = href;
}

/** Leaves settings for the workspace location it was opened from. */
export function closeSettings(router: RegisteredRouter): void {
  void router.navigate({ href: workspaceHref, replace: true });
}

/** Leaves settings for Environments, over the workspace location settings was opened from. */
export function openEnvironmentsFromSettings(router: RegisteredRouter): void {
  const url = new URL(workspaceHref, "https://nyte.invalid");
  url.searchParams.set("environment", "connections");
  void router.navigate({ href: `${url.pathname}${url.search}${url.hash}`, replace: true });
}
