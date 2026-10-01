"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Button } from "@nyte-ai/ui";

export function TooltipDemo() {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<Button iconOnly icon="copy" aria-label="Copy output" title={undefined} />}
        />
        <TooltipContent>{"Copy output"}</TooltipContent>
      </Tooltip>
      <PreviewCard>
        <PreviewCardTrigger render={<Button variant="outline">Snippet</Button>} />
        <PreviewCardContent>{"const answer = 42;\nconsole.log(answer);"}</PreviewCardContent>
      </PreviewCard>
    </>
  );
}
