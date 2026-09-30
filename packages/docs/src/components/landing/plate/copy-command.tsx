"use client";

import { IconCheckmark1Small, IconClipboard } from "central-icons";
import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex h-10 max-w-full items-center gap-3 rounded-[12px] bg-(--nyte-bg-muted-translucent) pr-1 pl-4 font-mono text-[13px]">
      <span aria-hidden="true" className="text-(--nyte-content-tertiary) select-none">
        $
      </span>
      <code className="min-w-0 truncate">{command}</code>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy command"}
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-(--nyte-content-secondary) transition-colors hover:bg-(--nyte-bg-hover) hover:text-(--nyte-content-primary)"
        onClick={async () => {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1300);
        }}
      >
        {copied ? <IconCheckmark1Small size={14} /> : <IconClipboard size={14} />}
      </button>
    </div>
  );
}
