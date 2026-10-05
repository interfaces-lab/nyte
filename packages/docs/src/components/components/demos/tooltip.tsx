"use client";

import { Button } from "@nyte-ai/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@nyte-ai/ui/tooltip";

export function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<Button iconOnly icon="copy" aria-label="Copy output" title={undefined} />}
        />
        <TooltipContent>Copy output</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={<Button iconOnly icon="trash" aria-label="Delete session" title={undefined} />}
        />
        <TooltipContent>Delete session ⌘⌫</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
