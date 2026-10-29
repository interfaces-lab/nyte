import type { BackgroundItem, HeadInfo, HeadName, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

/** Every background item a session's runs started: its jobs, held pages and child sessions. */
export function backgroundItems(
  kernel: Pick<Kernel, "jobs" | "pages" | "children">,
  session: SessionId,
): readonly { readonly head: HeadName; readonly item: BackgroundItem }[] {
  return [
    ...kernel.jobs.background(session),
    ...kernel.pages.background(session),
    ...kernel.children.background(session),
  ];
}

export function countBackground(items: readonly BackgroundItem[]): HeadInfo["background"] {
  return {
    working: items.filter((item) => item.state === "working").length,
    waiting: items.filter((item) => item.state === "waiting").length,
  };
}
