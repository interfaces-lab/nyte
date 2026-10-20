import type { RegisteredRouter } from "@tanstack/react-router";

let workspaceHref = "/";

export function rememberWorkspaceHref(href: string): void {
  workspaceHref = href;
}

export function closeSettings(router: RegisteredRouter): void {
  void router.navigate({ href: workspaceHref, replace: true });
}
