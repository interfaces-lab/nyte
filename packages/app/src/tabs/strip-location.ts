import type { useRouter } from "@tanstack/react-router";
import type { TabTarget } from "./strip.ts";

type AppRouter = ReturnType<typeof useRouter>;

/**
 * /session/$sessionId    a session tab
 * /?draft=$draftId       a draft tab
 * /?customize=$section   Customize
 * /?environment=$section Environments
 * /?inbox                Needs you
 * /                      no target; the store opens a new draft tab and replaces the URL
 */
export function targetHref(target: TabTarget): string {
  void target;
  throw new Error("not implemented");
}

export function locationTarget(router: AppRouter): TabTarget | undefined {
  void router;
  throw new Error("not implemented");
}
