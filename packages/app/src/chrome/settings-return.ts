import type { AnyRouter } from "@tanstack/react-router";

let workspaceHref = "/";

export function rememberWorkspaceHref(href: string): void {
  workspaceHref = href;
}

/** Leaves settings for the workspace location it was opened from. */
export function closeSettings(router: AnyRouter): void {
  void router.navigate({ href: workspaceHref, replace: true });
}
