import { props } from "@stylexjs/stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { boardStyles } from "./board.stylex.ts";
import { onCommand, useView } from "./bridge.ts";
import { useCamera } from "./camera.ts";
import { describeSheetError, FrameChrome } from "./frame-chrome.tsx";
import type { Point, WorldRect } from "./frame-chrome.tsx";
import { pick, useGestures } from "./gestures.ts";
import { useCommands } from "./messages.ts";
import { usePageFrames } from "./page-frames.ts";
import { findGlowing, findLit, Rings, useHover } from "./selection.tsx";
import { useDrawn } from "./sheets.ts";
import type { SheetBox } from "./sheets.ts";

interface Anchors {
  readonly signature: string;
  readonly settled: boolean;
  readonly at: ReadonlyMap<string, Point>;
}

const GAP = 160;

const OPEN_ROOM = 100_000;

const FAILURE: Point = { x: 360, y: 120 };

const GROUPS = ["controls", "blocks", "screens"] as const;

function group(path: string): number {
  const at = GROUPS.findIndex((name) => path.includes(`/${name}/`) || path.includes(`/${name}.`));

  return at === -1 ? GROUPS.length : at;
}

function extent(sheet: SheetBox): Point {
  if (sheet.frames.length === 0) return FAILURE;

  return {
    x: Math.max(...sheet.frames.map((frame) => frame.x + frame.width)),
    y: Math.max(...sheet.frames.map((frame) => frame.y + frame.height)),
  };
}

function placeSheets(sheets: readonly SheetBox[]): ReadonlyMap<string, Point> {
  const at = new Map<string, Point>();
  let y = 0;

  for (const row of [...GROUPS, "other"].keys()) {
    let x = 0;
    let tallest = 0;

    for (const sheet of sheets.filter(
      (item) => group(item.path) === row && (item.frames.length > 0 || item.error !== null),
    )) {
      const size = extent(sheet);
      at.set(sheet.path, { x, y });
      x += size.x + GAP;
      tallest = Math.max(tallest, size.y);
    }

    if (tallest > 0) y += tallest + GAP;
  }

  return at;
}

function findRoom(frame: WorldRect, frames: readonly WorldRect[]): number {
  return Math.max(
    0,
    Math.min(
      OPEN_ROOM,
      ...frames.flatMap((other) =>
        other !== frame &&
        other.y < frame.y &&
        other.x < frame.x + frame.width &&
        other.x + other.width > frame.x
          ? [frame.y - other.y - other.height]
          : [],
      ),
    ),
  );
}

export function Board(input: { readonly host: HTMLElement }): ReactElement {
  const host = input.host;
  const drawn = useDrawn();
  const view = useView();
  const hover = useHover();

  const [anchors, setAnchors] = useState<Anchors>({
    signature: "",
    settled: false,
    at: new Map(),
  });

  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useCamera({ stage, world, onMove: () => pageFrames.report() });
  const gestures = useGestures({ stage, camera, hover });
  const held = gestures.held;

  const sheets = drawn.sheets;

  const signature = sheets
    .map(
      (sheet) =>
        `${sheet.path}:${String(sheet.frames.length)}:${sheet.error === null ? "" : "failed"}`,
    )
    .join("|");

  const settled = sheets.every((sheet) =>
    sheet.frames.every((frame) => frame.width > 0 && frame.height > 0),
  );

  const stale = anchors.signature !== signature || !anchors.settled;
  const placed = stale ? placeSheets(sheets) : anchors.at;

  if (
    stale &&
    (anchors.signature !== signature ||
      anchors.settled !== settled ||
      [...placed].some((entry) => {
        const at = anchors.at.get(entry[0]);

        return at?.x !== entry[1].x || at.y !== entry[1].y;
      }))
  )
    setAnchors({ signature, settled, at: placed });
  const lit = gestures.editing === null ? findLit(host, view.lights.you) : null;
  const glowing = findGlowing(sheets, view.lights.agents);
  const pageFrames = usePageFrames({ sheets, placed, lit, zoom: () => camera.at().zoom });

  const commanded = useCommands({
    camera,
    gestures,
    pages: pageFrames,
    focus: () => stage.current?.focus(),
  });

  const frames = sheets.flatMap((sheet) => {
    const at = placed.get(sheet.path);

    return at === undefined
      ? []
      : sheet.frames.map((frame) => {
          const place = held?.key === frame.key ? held.at : frame;

          return {
            key: frame.key,
            x: at.x + place.x,
            y: at.y + place.y,
            width: frame.width,
            height: frame.height,
          };
        });
  });

  const rooms = new Map(frames.map((frame) => [frame.key, findRoom(frame, frames)]));

  const framed = useEffectEvent(camera.reframe);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- frames the imperative camera once React has laid a new set of sheets out
  useLayoutEffect(() => {
    if (anchors.settled) framed();
  }, [anchors]);

  const onWheel = useEffectEvent((event: WheelEvent): void => {
    event.preventDefault();
    camera.wheel({
      x: event.clientX,
      y: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      zoom: event.ctrlKey,
    });
  });

  const onPointerDown = useEffectEvent((event: PointerEvent) =>
    gestures.pointerDown(event, pageFrames),
  );

  const onPointerMove = useEffectEvent((event: PointerEvent) =>
    gestures.pointerMove(event, pageFrames),
  );

  const onPointerUp = useEffectEvent(() => gestures.pointerUp());

  const onDoubleClick = useEffectEvent((event: MouseEvent) =>
    gestures.doubleClick(event, pageFrames),
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => gestures.keyDown(event, pageFrames));

  const onPointerLeave = useEffectEvent(() => hover.point(null, null));

  const onAnswer = useEffectEvent(commanded);

  useMountEffect(() => {
    const node = stage.current;

    camera.apply();

    if (node === null) return undefined;
    const wheel = (event: WheelEvent): void => onWheel(event);
    const down = (event: PointerEvent): void => onPointerDown(event);
    const move = (event: PointerEvent): void => onPointerMove(event);
    const up = (): void => onPointerUp();
    const double = (event: MouseEvent): void => onDoubleClick(event);
    const key = (event: KeyboardEvent): void => onKeyDown(event);
    const leave = (): void => onPointerLeave();

    const swallow = (event: Event): void => {
      if (pick(event)?.closest("[contenteditable]") === null) event.preventDefault();
      event.stopPropagation();
    };

    let size = "";

    const resized = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const next = `${String(box?.width)}x${String(box?.height)}`;

      if (next === size) return;
      size = next;
      framed();
    });

    const listening = new AbortController();
    const signal = listening.signal;

    node.addEventListener("wheel", wheel, { passive: false, signal });
    node.addEventListener("pointerdown", down, { capture: true, signal });
    node.addEventListener("pointermove", move, { signal });
    node.addEventListener("pointerup", up, { signal });
    node.addEventListener("pointercancel", up, { signal });
    node.addEventListener("pointerleave", leave, { signal });
    node.addEventListener("dblclick", double, { capture: true, signal });
    node.addEventListener("click", swallow, { capture: true, signal });
    node.addEventListener("submit", swallow, { capture: true, signal });
    node.addEventListener("keydown", key, { signal });
    resized.observe(node);
    const stop = onCommand((message) => onAnswer(message));

    return () => {
      stop();
      resized.disconnect();
      listening.abort();
    };
  });

  return (
    <div
      {...props(boardStyles.stage, gestures.panning && boardStyles.panning)}
      style={{ colorScheme: view.scheme }}
      ref={stage}
      tabIndex={0}
      role="application"
      aria-label="Design board"
    >
      <div {...props(boardStyles.world)} ref={world}>
        {sheets.flatMap((sheet) => {
          const at = placed.get(sheet.path);

          return at === undefined
            ? []
            : [
                <div
                  key={sheet.path}
                  data-sheet-slot
                  style={{ insetInlineStart: at.x, insetBlockStart: at.y }}
                >
                  <slot name={sheet.path} />
                </div>,
              ];
        })}
        <div {...props(boardStyles.layer)}>
          {sheets.flatMap((sheet) => {
            const at = placed.get(sheet.path);

            if (at === undefined) return [];

            if (sheet.error !== null && sheet.frames.length === 0)
              return [
                <div
                  key={sheet.path}
                  role="alert"
                  {...props(text.sm, boardStyles.failure)}
                  style={{ insetInlineStart: at.x, insetBlockStart: at.y, width: FAILURE.x }}
                >
                  {`${sheet.path} could not be drawn.\n${describeSheetError(sheet.error)}`}
                </div>,
              ];

            return sheet.frames.map((frame) => (
              <FrameChrome
                key={frame.key}
                sheet={sheet.path}
                frame={frame}
                page={pageFrames.pages.find((page) => page.frame === frame)?.state ?? null}
                at={at}
                held={held?.key === frame.key ? held.at : null}
                room={held?.key === frame.key ? OPEN_ROOM : (rooms.get(frame.key) ?? OPEN_ROOM)}
                lit={lit === frame.key}
                pointed={hover.pointedFrame === frame.key}
                glowing={glowing.has(frame.key)}
                error={sheet.error}
              />
            ));
          })}
          <Rings
            host={host}
            sheets={sheets}
            placed={placed}
            held={held}
            pointed={hover.pointed}
            lit={lit}
            readOnly={gestures.readOnly}
            refusal={gestures.refusal}
            editing={gestures.editing?.node ?? null}
          />
        </div>
      </div>
    </div>
  );
}
