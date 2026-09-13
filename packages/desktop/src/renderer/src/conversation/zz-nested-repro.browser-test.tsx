import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import "@nyte-ai/ui/platform-tokens.css";
import "../theme/tokens.css";
import "../theme/global.css";
import { WorkGroupView } from "./tool-group.tsx";
import type { WorkTurnPart } from "./transcript-presentation.ts";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle(frames = 12) {
  for (let index = 0; index < frames; index += 1) await frame();
}

const parts: WorkTurnPart[] = Array.from({ length: 300 }, (_, index) => ({
  kind: "thinking",
  commit: String(index),
  contentIndex: 0,
  text: `Work ${String(index)} lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
}));

type Row = { key: string; kind: "prose" | "group" };
const rows: Row[] = [
  { key: "u1", kind: "prose" },
  { key: "a1", kind: "prose" },
  { key: "g1", kind: "group" },
  { key: "u2", kind: "prose" },
];

function Plane({ direct, pinEnd }: { direct: boolean; pinEnd: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "group" ? 400 : 120),
    getItemKey: (index) => rows[index]?.key ?? index,
    directDomUpdates: direct,
    directDomUpdatesMode: "position",
    initialRect: { width: 0, height: 0 },
    initialOffset: 0,
    overscan: 2,
    paddingStart: 16,
    paddingEnd: 16,
  });
  useLayoutEffect(() => {
    if (pinEnd) virtualizer.scrollToEnd();
  }, [pinEnd, virtualizer]);
  return (
    <div
      ref={scrollRef}
      data-nyte-scrollport="balanced"
      id="scroll"
      style={{ height: 500, overflowY: "auto", position: "relative" }}
    >
      <div
        ref={direct ? virtualizer.containerRef : undefined}
        style={{ position: "relative", height: direct ? undefined : virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-outer-row={row.key}
              style={{
                position: "absolute",
                insetInline: 0,
                ...(direct ? {} : { top: item.start }),
              }}
            >
              {row.kind === "prose" ? (
                <p style={{ height: 120, margin: 0 }}>{row.key}</p>
              ) : (
                <WorkGroupView
                  parts={parts}
                  liveTools={new Map()}
                  cwd={undefined}
                  durationMs={0}
                  running={false}
                  density="detailed"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function describe(host: HTMLElement): string {
  const scroll = host.querySelector<HTMLElement>("#scroll");
  if (scroll === null) return "no scroll";
  const port = scroll.getBoundingClientRect();
  const group = host.querySelector<HTMLElement>("[data-outer-row='g1']");
  const groupRect = group?.getBoundingClientRect();
  const paragraphs = Array.from(host.querySelectorAll("p")).filter((p) =>
    p.textContent?.startsWith("Work "),
  );
  const visible = paragraphs.filter((p) => {
    const r = p.getBoundingClientRect();
    return r.bottom > port.top && r.top < port.bottom;
  });
  const first = paragraphs[0]?.textContent ?? "-";
  const last = paragraphs.at(-1)?.textContent ?? "-";
  const outerTops = Array.from(host.querySelectorAll<HTMLElement>("[data-outer-row]"))
    .map((el) => `${el.dataset.outerRow ?? ""}@${el.style.top}`)
    .join(",");
  return [
    `scrollTop=${String(scroll.scrollTop)}/${String(scroll.scrollHeight)}`,
    `group=${groupRect === undefined ? "none" : `${String(Math.round(groupRect.top - port.top))}..${String(Math.round(groupRect.bottom - port.top))}`}`,
    `groupSpansViewport=${String(groupRect !== undefined && groupRect.top < port.top + 10 && groupRect.bottom > port.bottom - 10)}`,
    `workRows=${String(paragraphs.length)} [${first}..${last}]`,
    `visibleWorkRows=${String(visible.length)}`,
    `outerRows=${outerTops}`,
  ].join(" | ");
}

async function scenario(label: string, direct: boolean, pinEnd: boolean): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<Plane direct={direct} pinEnd={pinEnd} />));
    await settle(20);
    const after = describe(host);
    // A user interaction that scrolls by one pixel: does the group recover?
    const scroll = host.querySelector<HTMLElement>("#scroll");
    if (scroll !== null) scroll.scrollTop -= 1;
    await settle(20);
    const nudged = describe(host);
    return `${label}\n  settled: ${after}\n  nudged:  ${nudged}`;
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}

export async function run() {
  const results = [
    await scenario("control: react top, scroll to end", false, true),
    await scenario("direct position, scroll to end", true, true),
    await scenario("direct position, top", true, false),
    await scenario("control: react top, top", false, false),
  ];
  return results.join("\n");
}
