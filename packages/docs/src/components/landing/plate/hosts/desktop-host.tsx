import { IconChevronDownMedium } from "central-icons-desktop";
import { Bezel } from "./bezel";
import {
  DesktopComposer,
  DesktopSidebar,
  DesktopTitleBar,
  EditStat,
  ToolLine,
} from "./desktop-chrome";
import { EDIT_STATS, editDiffHTML } from "./edit-diff";
import { PrerenderedDiff } from "./prerendered-diff";

/* The session's first turn, as every host shows it. Async for the prerendered diff. */
export async function DesktopTranscript() {
  const diff = await editDiffHTML();

  return (
    <>
      <p className="mb-1 rounded-[12px] border border-border-subtle bg-popover px-2.5 py-2">
        Stored runs from 0.0.8 fail to open. Migrate them when the store opens, and keep sessions we
        can&rsquo;t read out of the sidebar.
      </p>

      <div className="flex min-w-0 flex-col">
        <div className="flex min-h-6 min-w-0 items-center gap-1 text-muted-foreground">
          <span className="shrink-0">Edited</span>
          <span className="min-w-0 truncate">
            store-schemas.ts, explored store-schemas.ts, ran 2 commands
          </span>
          <span className="flex shrink-0 gap-1.5 tabular-nums">
            <EditStat {...EDIT_STATS} />
          </span>
          <IconChevronDownMedium size={16} className="ml-0.5 shrink-0 rotate-180" />
        </div>
        <div className="flex flex-col gap-1.5 pt-1.5">
          <ToolLine verb="Read" detail="store-schemas.ts" />
          <ToolLine verb="Ran" detail={'rg -n "schemaVersion" packages/core/src'} expandable />
          <div>
            <ToolLine verb="Edited" detail="store-schemas.ts" expandable open>
              <span className="ml-2 flex shrink-0 gap-1 tabular-nums">
                <EditStat {...EDIT_STATS} />
              </span>
            </ToolLine>
            <div className="mt-1 mb-0.5 overflow-clip rounded-[8px] border border-border-subtle bg-background">
              <PrerenderedDiff html={diff} className="desktop-diff" />
            </div>
          </div>
          <ToolLine verb="Ran" detail="pnpm --dir packages/core test" expandable />
        </div>
      </div>

      <p className="text-pretty">
        Runs from older schemas now migrate when the store opens. A session that still fails to
        parse stays on disk, but it no longer shows in the sidebar or in search.
      </p>
    </>
  );
}

export function DesktopHost() {
  return (
    <Bezel className="h-full">
      <div className="desktop-host flex h-full flex-col overflow-clip rounded-t-[14px] text-left text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
        <DesktopTitleBar />

        <div className="flex min-h-0 flex-1">
          <DesktopSidebar />

          <div className="relative mr-2 mb-2 min-w-0 flex-1 overflow-clip rounded-[12px] bg-background shadow-[0_0_0_1px_var(--nyte-border-secondary-translucent)] max-md:ml-2">
            <div className="mx-auto flex max-w-[840px] flex-col gap-2 px-4 pt-[26px] text-[15px]/6 tracking-[-0.016em]">
              <DesktopTranscript />
            </div>

            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-background from-60% to-transparent px-4 pt-8 pb-3.5 max-sm:hidden">
              <DesktopComposer>
                <span className="min-w-0 flex-1 truncate text-[15px] tracking-[-0.016em] text-muted-foreground">
                  Add a follow-up
                </span>
              </DesktopComposer>
            </div>
          </div>
        </div>
      </div>
    </Bezel>
  );
}
