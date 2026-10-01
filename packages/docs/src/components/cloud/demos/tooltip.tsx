"use client";

import { Button } from "@nyte-ai/ui";
import { Hint, HoverPreview } from "@nyte-ai/ui/tooltip";

export function TooltipDemo() {
  return (
    <>
      <Hint
        content="Copy output"
        trigger={<Button iconOnly icon="copy" aria-label="Copy output" title={undefined} />}
      />
      <HoverPreview
        content={"const answer = 42;\nconsole.log(answer);"}
        trigger={<Button variant="outline">Snippet</Button>}
      />
    </>
  );
}
