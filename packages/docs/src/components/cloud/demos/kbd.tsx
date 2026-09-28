"use client";

import { Kbd } from "@nyte-ai/ui/kbd";

export function KbdDemo() {
  return (
    <>
      <Kbd keys={["⌘", "K"]} />
      <Kbd keys={["⇧", "⌘", "D"]} />
      <Kbd keys={["⌘", "N"]} plain />
    </>
  );
}
