import { useLayoutEffect, useRef, useState } from "react";
import { MAX_PAGE_FRAMES, readSpanKey, spanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { BoardPage, PageState, Span } from "@nyte-ai/plugin/design/board-protocol";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { post } from "./bridge.ts";
import type { Point } from "./frame-chrome.tsx";
import type { FrameBox, SheetBox } from "./sheets.ts";

export interface PageFrame {
  readonly frame: FrameBox;
  readonly span: Span;
  readonly url: string;
  readonly state: PageState;
}

export interface PageFrames {
  readonly pages: readonly PageFrame[];
  readonly findAt: (target: Element | null) => PageFrame | undefined;
  readonly enter: (key: string) => void;
  readonly enterLive: (key: Span) => void;
  readonly leave: () => void;
  readonly leaveOutside: (press: PointerEvent) => boolean;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly report: () => void;
}

export function usePageFrames(input: {
  readonly sheets: readonly SheetBox[];
  readonly placed: ReadonlyMap<string, Point>;
  readonly lit: string | null;
  readonly zoom: () => number;
}): PageFrames {
  const [entered, setEntered] = useState<string | null>(null);
  const [seenLit, setSeenLit] = useState<string | null>(null);
  const shown = useRef<readonly PageFrame[]>([]);
  const scheduled = useRef(0);
  const sent = useRef("[]");
  const lit = input.lit;
  const found = findPages(input.sheets, input.placed);
  const keys = new Set(found.map((page) => page.frame.key));

  if (lit !== seenLit) {
    setSeenLit(lit);

    if (entered !== null && entered !== lit) setEntered(null);
  }

  if (entered !== null && !keys.has(entered)) setEntered(null);

  const pages = found.map((page): PageFrame => ({
    ...page,
    state:
      entered === null
        ? page.frame.key === lit
          ? "live"
          : "still"
        : page.frame.key === entered
          ? "entered"
          : "still",
  }));

  const send = (): void => {
    scheduled.current = 0;

    const report = shown.current.map((page): BoardPage => {
      const box = page.frame.node.getBoundingClientRect();
      const width = page.frame.node.offsetWidth;

      return {
        key: page.span,
        url: page.url,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        scale: width > 0 && box.width > 0 ? box.width / width : input.zoom(),
        state: page.state,
      };
    });

    const text = JSON.stringify(report);

    if (text === sent.current) return;
    sent.current = text;
    post({ kind: "pages", pages: report });
  };

  const report = (): void => {
    if (scheduled.current === 0) scheduled.current = requestAnimationFrame(send);
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- a commit can move, resize or change the state of a page frame, and the app lays its page over the frame
  useLayoutEffect(() => {
    shown.current = pages;
    report();
  });

  useMountEffect(() => () => cancelAnimationFrame(scheduled.current));

  return {
    pages,
    findAt: (target) =>
      target === null ? undefined : pages.find((page) => page.frame.node.contains(target)),
    enter: setEntered,
    enterLive: (key) => {
      const live = pages.find((page) => page.state === "live");

      if (live !== undefined && live.frame.key === spanKey(key)) setEntered(live.frame.key);
    },
    leave: () => setEntered(null),
    leaveOutside: (press) => {
      const inside = pages
        .find((page) => page.state === "entered")
        ?.frame.node.getBoundingClientRect();

      if (
        inside === undefined ||
        (press.clientX >= inside.left &&
          press.clientX <= inside.right &&
          press.clientY >= inside.top &&
          press.clientY <= inside.bottom)
      )
        return false;
      setEntered(null);

      return true;
    },
    onKey: (event) => {
      const live = pages.find((page) => page.state === "live");

      if (event.key === "Escape" && entered !== null) {
        setEntered(null);

        return true;
      }

      if (event.key !== "Enter" || live === undefined) return false;
      event.preventDefault();
      setEntered(live.frame.key);

      return true;
    },
    report,
  };
}

function findPages(
  sheets: readonly SheetBox[],
  placed: ReadonlyMap<string, Point>,
): readonly Omit<PageFrame, "state">[] {
  const seen = new Set<string>();

  return sheets
    .filter((sheet) => placed.has(sheet.path))
    .flatMap((sheet) => sheet.frames)
    .flatMap((frame) => {
      const span = readSpanKey(frame.key);

      if (frame.page === null || span === undefined || seen.has(frame.key)) return [];
      seen.add(frame.key);

      return [{ frame, span, url: frame.page }];
    })
    .slice(0, MAX_PAGE_FRAMES);
}
