import type { ReactNode } from "react";
import { Bezel } from "./bezel";

/* One terminal row: preformatted, so leading spaces and the TUI's two-space gaps survive. */
const row = "overflow-hidden text-ellipsis whitespace-pre";

function Tool({ verb, subject, children }: { verb: string; subject: string; children: ReactNode }) {
  return (
    <div className={`${row} pl-[3ch]`}>
      <span className="text-(--t-success)">✓</span> <span className="text-(--t-tool)">{verb}</span>{" "}
      {subject}
      {"  "}
      {children}
    </div>
  );
}

/*
 * The TUI's chat screen, from packages/tui: no header, a grey band for the
 * prompt, lowercase tool rows, and a composer whose bottom edge carries the
 * status line. Colours are the TUI theme's, light and dark.
 */
export function TerminalHost() {
  return (
    <Bezel className="mx-auto h-full w-full max-w-[960px]">
      <div className="flex h-full flex-col overflow-hidden rounded-t-[14px] bg-(--t-bg) text-left text-(--t-fg) shadow-[0_0_0_1px_rgb(0_0_0/0.05)] [--t-accent:#1a85d4] [--t-band-fg:#404040] [--t-band:#ededed] [--t-bg:#ffffff] [--t-border:#a3a3a3] [--t-chrome:#f5f5f5] [--t-danger:#d52c36] [--t-dim:#737373] [--t-fg:#0a0a0a] [--t-rule:#d4d4d4] [--t-success:#18a46c] [--t-tool:#525252] dark:[--t-accent:#009fff] dark:[--t-band-fg:#d4d4d4] dark:[--t-band:#1d1d1d] dark:[--t-bg:#0a0a0a] dark:[--t-border:#525252] dark:[--t-chrome:#171717] dark:[--t-danger:#ff2e3f] dark:[--t-fg:#fafafa] dark:[--t-rule:#2c2c2c] dark:[--t-success:#07c480] dark:[--t-tool:#a3a3a3]">
        <div className="relative flex h-8 shrink-0 items-center justify-center border-b border-(--t-rule) bg-(--t-chrome) px-3 text-[12px] text-(--t-band-fg)">
          <div className="absolute left-3 flex gap-2">
            <span className="size-2.5 rounded-full bg-(--t-fg)/20" />
            <span className="size-2.5 rounded-full bg-(--t-fg)/20" />
            <span className="size-2.5 rounded-full bg-(--t-fg)/20" />
          </div>
          <span className="min-w-0 truncate px-20">
            nyte<span className="max-sm:hidden"> - Migrate stored runs on open</span>
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col pb-4 font-mono text-[12px]/[1.5] sm:text-[13px]/[1.5]">
          <div className="min-h-0 flex-1 overflow-hidden pt-[1.5em]">
            <p className="mx-[1ch] bg-(--t-band) px-[3ch] py-[1.5em] text-(--t-band-fg)">
              Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
              sessions we can&apos;t read out of the sidebar.
            </p>

            <div className="mt-[1.5em]">
              <Tool verb="read" subject="packages/core/src/kernel/store-schemas.ts">
                <span className="text-(--t-dim)">286 lines · ctrl+o expand</span>
              </Tool>
              <Tool verb="ran" subject={'rg -n "schemaVersion" packages/core/src'}>
                <span className="text-(--t-dim)">14 lines · 0.2s</span>
              </Tool>
              <Tool verb="edited" subject="packages/core/src/kernel/store-schemas.ts">
                <span className="text-(--t-success)">+3</span>{" "}
                <span className="text-(--t-danger)">-1</span>
              </Tool>
              <div className={`${row} pl-[3ch] text-(--t-danger)`}>{"     87 -  return rows;"}</div>
              <div className={`${row} pl-[3ch] text-(--t-success)`}>{"     87 +  return rows"}</div>
              <div className={`${row} pl-[3ch] text-(--t-success)`}>
                {"     88 +    .filter(isReadableRun)"}
              </div>
              <div className={`${row} pl-[3ch] text-(--t-success)`}>
                {"     89 +    .map(migrateRun);"}
              </div>
              <Tool verb="ran" subject="pnpm --dir packages/core test">
                <span className="text-(--t-dim)">312 lines · 4.8s</span>
              </Tool>
            </div>

            <p className="mt-[1.5em] pr-[2ch] pl-[3ch]">
              Runs from older schemas now migrate when the store opens. A session that still fails
              to parse stays on disk, but it no longer shows in the sidebar or in search.
            </p>
            <p className="mt-[1.5em] pl-[3ch] text-(--t-dim)">Worked for 6.3s</p>
          </div>

          <div className="mx-[1.5ch] mt-[0.75em] shrink-0 text-(--t-border)">
            <div className="rounded-t-[6px] border-x border-t border-current px-[1.5ch] pt-[0.75em]">
              <div className={row}>
                <span className="text-(--t-accent)">❯ </span>
                <span className="text-(--t-dim)">Plan, search, build anything</span>
              </div>
            </div>
            <div className="flex h-[1.5em]">
              <span className="h-1/2 w-[1.5ch] shrink-0 rounded-bl-[6px] border-b border-l border-current" />
              <span className={`${row} shrink px-[1ch] text-(--t-fg)`}>
                nyte main* <span className="text-(--t-border)">│</span> gpt-5.6-sol{" "}
                <span className="text-(--t-border)">│</span> high{" "}
                <span className="text-(--t-border)">│</span> 12.3k/272.0k · 5% context
              </span>
              <span className="h-1/2 min-w-[1ch] flex-1 border-b border-current" />
              <span className="h-1/2 w-[1ch] shrink-0 rounded-br-[6px] border-r border-b border-current" />
            </div>
          </div>

          <p className={`${row} shrink-0 pl-[3ch] text-(--t-dim)`}>
            ctrl+k commands · ctrl+p model · shift+tab thinking · ctrl+g editor
          </p>
        </div>
      </div>
    </Bezel>
  );
}
