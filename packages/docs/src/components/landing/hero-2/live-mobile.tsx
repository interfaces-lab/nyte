"use client";

import { IconChevronRightSmall } from "central-icons";
import {
  ChatActions,
  ChatHeader,
  Composer,
  FileRow,
  Phone,
  ToolRow,
  mobilePalette,
} from "../plate/hosts/mobile-host";
import type { ClientProps } from "./live-terminal";
import type { Turn } from "./use-session";

function MobileTurn({ turn }: { turn: Turn }) {
  return (
    <>
      <div className="mt-4 flex justify-end py-1">
        <p className="max-w-[80%] rounded-[20px] bg-(--mobile-raised) px-[14px] py-[10px] text-[16px]/[22px] break-words">
          {turn.text}
        </p>
      </div>
      {turn.tools.length > 0 || turn.phase === "working" ? (
        <div className="px-2 py-1.5">
          <div className="flex min-h-11 items-center gap-1 text-[15px]/5 text-(--mobile-muted)">
            {turn.phase === "done" ? (
              <>
                <span>Finished</span>
                <span className="tabular-nums opacity-70">{Math.round(turn.seconds)}s</span>
              </>
            ) : (
              <span>Working</span>
            )}
            <IconChevronRightSmall size={13} className="rotate-90 [&_path]:stroke-2" />
          </div>
          <div className="pl-[22px]">
            {turn.tools.map((tool) =>
              tool.added ? (
                <FileRow key={tool.verb} name={tool.file} added={tool.added} removed={0} />
              ) : (
                <ToolRow key={tool.verb}>
                  {tool.verb} {tool.file}
                </ToolRow>
              ),
            )}
          </div>
        </div>
      ) : null}
      {turn.reply ? (
        <div className="px-2 py-1.5">
          <p className="text-[16px]/[22px]">{turn.reply}</p>
        </div>
      ) : null}
    </>
  );
}

/* The phone at 390×844 points, scaled to the stage's --phone-h. */
export function LiveMobile({ transcript, turns, draft, onDraft, onSend }: ClientProps) {
  return (
    <div
      style={mobilePalette}
      className="relative h-full w-full text-left font-[system-ui,-apple-system,'SF_Pro_Text',sans-serif] antialiased"
    >
      <div className="absolute top-0 left-0 origin-top-left scale-[calc(var(--phone-h)/844px)]">
        <Phone>
          <div className="flex h-full flex-col bg-(--mobile-canvas)">
            <ChatHeader />
            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-clip px-3 pt-3">
              <div className="mb-auto">
                {transcript}
                {turns.map((turn) => (
                  <MobileTurn key={turn.id} turn={turn} />
                ))}
              </div>
            </div>
            <ChatActions />
            <form
              className="shrink-0"
              onSubmit={(event) => {
                event.preventDefault();
                onSend();
              }}
            >
              <Composer>
                <input
                  aria-label="Message"
                  value={draft}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) => onDraft(event.target.value)}
                  placeholder="Follow up…"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[17px]/[22px] text-(--mobile-foreground) outline-none placeholder:text-(--mobile-muted)"
                />
              </Composer>
            </form>
          </div>
        </Phone>
      </div>
    </div>
  );
}
