"use client";

import { Spinner } from "@nyte-ai/ui/spinner";
import {
  DesktopComposer,
  DesktopTitleBar,
  EditStat,
  ToolLine,
} from "../plate/hosts/desktop-chrome";
import type { ClientProps } from "./live-terminal";
import type { Turn } from "./use-session";

function DesktopTurn({ turn }: { turn: Turn }) {
  return (
    <>
      <p className="mt-4 mb-1 rounded-[12px] border border-border-subtle bg-popover px-2.5 py-2 break-words">
        {turn.text}
      </p>
      {turn.tools.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {turn.tools.map((tool) => (
            <ToolLine
              key={tool.verb}
              verb={tool.verb}
              detail={tool.file}
              expandable={tool.verb === "Ran"}
            >
              {tool.added ? (
                <span className="ml-2 flex shrink-0 gap-1 tabular-nums">
                  <EditStat added={tool.added} removed={0} />
                </span>
              ) : null}
            </ToolLine>
          ))}
        </div>
      ) : null}
      {turn.reply ? <p className="text-pretty">{turn.reply}</p> : null}
      {turn.phase === "working" ? (
        <div className="flex min-h-6 items-center gap-1.5 text-muted-foreground">
          <Spinner style={{ width: 14, height: 14 }} />
          Working
        </div>
      ) : null}
    </>
  );
}

export function LiveDesktop({ transcript, turns, draft, onDraft, onSend }: ClientProps) {
  return (
    <div className="desktop-host flex h-full flex-col overflow-clip rounded-[14px] text-left text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
      <DesktopTitleBar />
      <div className="relative mx-2 mb-2 min-h-0 flex-1 overflow-clip rounded-[12px] bg-background shadow-[0_0_0_1px_var(--nyte-border-secondary-translucent)]">
        <div className="flex h-full flex-col-reverse overflow-clip">
          <div className="mx-auto mb-auto flex w-full max-w-[840px] flex-col gap-2 px-4 pt-[26px] pb-24 text-[15px]/6 tracking-[-0.016em]">
            {transcript}
            {turns.map((turn) => (
              <DesktopTurn key={turn.id} turn={turn} />
            ))}
          </div>
        </div>

        <form
          className="absolute inset-x-0 bottom-0 bg-linear-to-t from-background from-60% to-transparent px-4 pt-8 pb-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <DesktopComposer ready={draft.trim().length > 0}>
            <input
              aria-label="Message"
              value={draft}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => onDraft(event.target.value)}
              placeholder="Add a follow-up"
              className="h-7 min-w-0 flex-1 bg-transparent text-[15px] tracking-[-0.016em] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </DesktopComposer>
        </form>
      </div>
    </div>
  );
}
