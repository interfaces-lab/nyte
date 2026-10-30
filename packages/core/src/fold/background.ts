import type { BackgroundItem, HeadInfo, HeadName, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

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

/** A held page is not work: it stays held until its session or client goes. */
export function countBackground(items: readonly BackgroundItem[]): HeadInfo["background"] {
  const counted = items.filter((item) => item.kind !== "page");

  return {
    working: counted.filter((item) => item.state === "working").length,
    waiting: counted.filter((item) => item.state === "waiting").length,
  };
}
