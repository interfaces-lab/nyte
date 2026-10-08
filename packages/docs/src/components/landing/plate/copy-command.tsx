"use client";

import { IconCheckmark1Small, IconClipboard } from "central-icons";
import { useRef, useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const attempt = useRef(0);
  const reset = useRef(0);

  return (
    <div className="flex h-10 max-w-full items-center gap-3 rounded-[12px] bg-muted pr-1 pl-4 font-mono text-[13px]">
      <span aria-hidden="true" className="text-tertiary-foreground select-none">
        $
      </span>
      <code className="min-w-0 truncate">{command}</code>
      <span
        role="status"
        className={
          status === "failed" ? "shrink-0 font-sans text-[12px] text-foreground" : "sr-only"
        }
      >
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : null}
      </span>
      <button
        type="button"
        aria-label="Copy command"
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground"
        onClick={async () => {
          attempt.current += 1;
          const current = attempt.current;
          window.clearTimeout(reset.current);
          let next: "copied" | "failed" = "copied";
          try {
            await navigator.clipboard.writeText(command);
          } catch {
            next = "failed";
          }
          if (current !== attempt.current) return;
          setStatus(next);
          reset.current = window.setTimeout(
            () => setStatus("idle"),
            next === "copied" ? 1300 : 4000,
          );
        }}
      >
        {status === "copied" ? <IconCheckmark1Small size={14} /> : <IconClipboard size={14} />}
      </button>
    </div>
  );
}
