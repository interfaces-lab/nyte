import type { ReactNode } from "react";
import { Bezel } from "./bezel";

const row = "overflow-hidden text-ellipsis whitespace-pre";
const rule = "─".repeat(160);

function Tool({ verb, subject, children }: { verb: string; subject: string; children: ReactNode }) {
  return (
    <div className={`${row} mt-[1lh]`}>
      <span className="text-(--t-success)">✓</span> {verb} {subject}
      {"  "}
      <span className="text-(--t-dim)">{children}</span>
    </div>
  );
}

function DiffLine({
  kind,
  line,
  children,
}: {
  kind: "added" | "removed" | "context";
  line: number;
  children: ReactNode;
}) {
  const colours = {
    added: {
      row: "bg-(--t-added-bg)",
      gutter: "bg-(--t-added-gutter)",
      sign: "text-(--t-added)",
      marker: " + ",
    },
    removed: {
      row: "bg-(--t-removed-bg)",
      gutter: "bg-(--t-removed-gutter)",
      sign: "text-(--t-removed)",
      marker: " - ",
    },
    context: {
      row: "bg-(--t-chrome)",
      gutter: "bg-(--t-chrome)",
      sign: "text-(--t-dim)",
      marker: "   ",
    },
  };
  const colour = colours[kind];

  return (
    <div className={`flex overflow-hidden whitespace-pre ${colour.row}`}>
      <span className={`w-[6ch] shrink-0 text-(--t-dim) ${colour.gutter}`}>
        {" "}
        {line}
        <span className={colour.sign}>{colour.marker}</span>
      </span>
      <span className="min-w-0 overflow-hidden">{children}</span>
    </div>
  );
}

export function TerminalHost() {
  return (
    <Bezel className="mx-auto h-full w-full max-w-[960px]">
      <div className="flex h-full flex-col overflow-hidden rounded-t-[14px] bg-(--t-bg) text-left text-(--t-fg) shadow-[0_0_0_1px_rgb(0_0_0/0.05)] [--t-accent:#1a85d4] [--t-added-bg:#e0efe1] [--t-added-gutter:#e5f1e6] [--t-added:#0dbe4e] [--t-band-fg:#404040] [--t-band:#ededed] [--t-bg:#ffffff] [--t-border:#a3a3a3] [--t-chrome:#f5f5f5] [--t-code:#d32a61] [--t-dim:#737373] [--t-fg:#0a0a0a] [--t-operator:#1ca1c7] [--t-path:#d47628] [--t-removed-bg:#fce1dd] [--t-removed-gutter:#fbe6e3] [--t-removed:#ff2e3f] [--t-rule:#d4d4d4] [--t-string:#199f43] [--t-success:#18a46c] [--t-thinking:#693acf] dark:[--t-accent:#009fff] dark:[--t-added-bg:#273628] dark:[--t-added-gutter:#232e23] dark:[--t-added:#5ecc71] dark:[--t-band-fg:#d4d4d4] dark:[--t-band:#1d1d1d] dark:[--t-bg:#0a0a0a] dark:[--t-border:#525252] dark:[--t-chrome:#171717] dark:[--t-code:#ff678d] dark:[--t-fg:#fafafa] dark:[--t-operator:#08c0ef] dark:[--t-path:#ffa359] dark:[--t-removed-bg:#402725] dark:[--t-removed-gutter:#362321] dark:[--t-removed:#ff6762] dark:[--t-rule:#2c2c2c] dark:[--t-string:#5ecc71] dark:[--t-success:#07c480] dark:[--t-thinking:#9d6afb]">
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

        <div className="@container flex min-h-0 flex-1 flex-col font-mono text-[12px]/[1.25]">
          <div className="min-h-0 flex-1 overflow-hidden pt-[1lh] pb-[1lh]">
            <p className="mx-[2ch] bg-(--t-band) py-[1lh] pr-[1ch] pl-[3ch]">
              Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep
              sessions we can&apos;t read out of the sidebar.
            </p>

            <div className="pr-[2ch] pl-[3ch]">
              <Tool verb="read" subject="packages/core/src/kernel/store-schemas.ts">
                286 lines · ctrl+o expand
              </Tool>
              <Tool verb="ran" subject={'rg -n "schemaVersion" packages/core/src'}>
                0.2s
              </Tool>
              <Tool verb="edited" subject="packages/core/src/kernel/store-schemas.ts">
                +3 -1
              </Tool>
              <div className="bg-(--t-chrome)">
                <div className={`${row} text-(--t-dim)`}>… 83 unchanged lines</div>
                <DiffLine kind="context" line={84}>
                  {"  "}
                  <span className="text-(--t-code)">const</span> rows{" "}
                  <span className="text-(--t-operator)">=</span> db
                </DiffLine>
                <DiffLine kind="context" line={85}>
                  {"    "}
                  <span className="text-(--t-dim)">.</span>
                  <span className="text-(--t-band-fg)">prepare</span>
                  <span className="text-(--t-dim)">(</span>
                  <span className="text-(--t-string)">
                    &quot;select * from runs order by seq&quot;
                  </span>
                  <span className="text-(--t-dim)">)</span>
                </DiffLine>
                <DiffLine kind="context" line={86}>
                  {"    "}
                  <span className="text-(--t-dim)">.</span>
                  <span className="text-(--t-band-fg)">all</span>
                  <span className="text-(--t-dim)">();</span>
                </DiffLine>
                <DiffLine kind="removed" line={87}>
                  {"  "}
                  <span className="text-(--t-code)">return</span> rows
                  <span className="text-(--t-dim)">;</span>
                </DiffLine>
                <DiffLine kind="added" line={87}>
                  {"  "}
                  <span className="text-(--t-code)">return</span> rows
                </DiffLine>
                <DiffLine kind="added" line={88}>
                  {"    "}
                  <span className="text-(--t-dim)">.</span>
                  <span className="text-(--t-band-fg)">filter</span>
                  <span className="text-(--t-dim)">(</span>isReadableRun
                  <span className="text-(--t-dim)">)</span>
                </DiffLine>
                <DiffLine kind="added" line={89}>
                  {"    "}
                  <span className="text-(--t-dim)">.</span>
                  <span className="text-(--t-band-fg)">map</span>
                  <span className="text-(--t-dim)">(</span>migrateRun
                  <span className="text-(--t-dim)">);</span>
                </DiffLine>
                <DiffLine kind="context" line={90}>
                  <span className="text-(--t-dim)">{"}"}</span>
                </DiffLine>
              </div>
              <Tool verb="ran" subject="pnpm --dir packages/core test">
                4.8s
              </Tool>
            </div>

            <p className="mt-[1lh] pr-[2ch] pl-[3ch]">
              Runs from older schemas now migrate when the store opens. A session that still fails
              to parse stays on disk, but it no longer shows in the sidebar or in search.
            </p>
            <p className="mt-[1lh] pl-[3ch] text-(--t-dim)">Worked for 6.3s</p>
          </div>

          <div className="mx-[1ch] shrink-0 text-(--t-border)">
            <div className="flex h-[1lh] whitespace-pre">
              <span>╭</span>
              <span className="min-w-0 flex-1 overflow-hidden">{rule}</span>
              <span>╮</span>
            </div>
            <div className="flex h-[1lh] whitespace-pre">
              <span>│</span>
              <div className={`${row} min-w-0 flex-1 px-[1ch]`}>
                <span className="text-(--t-band-fg)">❯ </span>
                <span className="text-(--t-dim)">Plan, search, build anything</span>
              </div>
              <span>│</span>
            </div>
            <div className="flex h-[1lh] whitespace-pre">
              <span>╰─ </span>
              <span className="hidden @min-[42ch]:inline">
                <span className="text-(--t-path)">nyte main*</span> │{" "}
              </span>
              <span className="shrink-0 text-(--t-accent)">gpt-5.6-luna</span>
              <span className="hidden @min-[29ch]:inline">
                {" │ "}
                <span className="text-(--t-thinking)">medium</span>
              </span>
              <span className="hidden @min-[70ch]:inline">
                {" │ "}
                <span className="text-(--t-dim)">12.3k/272.0k · 5% context</span>
              </span>
              <span> </span>
              <span className="min-w-0 flex-1 overflow-hidden">{rule}</span>
              <span>╯</span>
            </div>
          </div>

          <p className={`${row} mx-[1ch] h-[1lh] shrink-0 pl-[2ch] text-(--t-dim)`}>
            <span className="text-(--t-band-fg)">enter</span> send
            <span className="hidden @min-[33ch]:inline">
              {" · "}
              <span className="text-(--t-band-fg)">esc</span> tree (twice)
            </span>
            <span className="hidden @min-[47ch]:inline">
              {" · "}
              <span className="text-(--t-band-fg)">ctrl+k</span> help
            </span>
            <span className="hidden @min-[63ch]:inline">
              {" · "}
              <span className="text-(--t-band-fg)">ctrl+c</span> quit
            </span>
            <span className="hidden @min-[84ch]:inline">
              {" · "}
              <span className="text-(--t-band-fg)">shift+tab</span> thinking
            </span>
            <span className="hidden @min-[99ch]:inline">
              {" · "}
              <span className="text-(--t-band-fg)">ctrl+p</span> model
            </span>
          </p>
        </div>
      </div>
    </Bezel>
  );
}
