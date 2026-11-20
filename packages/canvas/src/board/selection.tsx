import { useState } from "react";
import type { ReactElement } from "react";
import { DESIGN_ATTRIBUTE, readSpanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { BoardSubject } from "@nyte-ai/plugin/design/board-protocol";
import { Ring } from "./frame-chrome.tsx";
import type { Point, Refusal, WorldRect } from "./frame-chrome.tsx";
import { readVia } from "./runtime.ts";
import type { SheetBox } from "./sheets.ts";

export interface Held {
  readonly key: string;
  readonly at: Point;
}

export interface Hover {
  readonly pointed: string | null;
  readonly pointedFrame: string | null;
  readonly point: (key: string | null, frame: string | null) => void;
}

const SOURCE = `[${DESIGN_ATTRIBUTE.source}]`;

function readKeys(node: Element): readonly string[] {
  const own = node.getAttribute(DESIGN_ATTRIBUTE.source);

  return own === null ? readVia(node) : [...readVia(node), own];
}

function findNodes(host: HTMLElement, key: string): readonly Element[] {
  const draws = (node: Element): boolean =>
    node.getAttribute(DESIGN_ATTRIBUTE.source) === key || readVia(node).includes(key);

  return [...host.querySelectorAll(SOURCE)].filter((node) => {
    if (!draws(node)) return false;

    for (let up = node.parentElement; up !== null && up !== host; up = up.parentElement)
      if (draws(up)) return false;

    return true;
  });
}

function measureRings(
  nodes: readonly Element[],
  sheets: readonly SheetBox[],
  placed: ReadonlyMap<string, Point>,
  held: Held | null,
): readonly (WorldRect & { readonly node: Element })[] {
  return sheets.flatMap((sheet) => {
    const at = placed.get(sheet.path);

    return at === undefined
      ? []
      : sheet.frames.flatMap((frame) => {
          const box = frame.node.getBoundingClientRect();
          const scale = frame.width > 0 && box.width > 0 ? box.width / frame.width : 1;
          const place = held?.key === frame.key ? held.at : frame;

          return nodes
            .filter((node) => frame.node.contains(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();

              return {
                x: at.x + place.x + (rect.left - box.left) / scale,
                y: at.y + place.y + (rect.top - box.top) / scale,
                width: rect.width / scale,
                height: rect.height / scale,
                node,
              };
            });
        });
  });
}

export function findLit(host: HTMLElement, subject: BoardSubject | null): string | null {
  if (subject === null || subject.kind !== "span") return null;

  const holders = [...host.querySelectorAll(SOURCE)]
    .flatMap(readKeys)
    .flatMap((key) => {
      const span = readSpanKey(key);

      return span !== undefined &&
        span.path === subject.path &&
        span.start <= subject.start &&
        span.end >= subject.end
        ? [{ key, size: span.end - span.start }]
        : [];
    })
    .toSorted((left, right) => left.size - right.size);

  return holders[0]?.key ?? null;
}

export function findGlowing(
  sheets: readonly SheetBox[],
  agents: readonly BoardSubject[],
): ReadonlySet<string> {
  return new Set(
    agents.flatMap((subject) =>
      sheets
        .filter((sheet) => sheet.reads.includes(subject.path))
        .flatMap((sheet) => {
          const touched = sheet.frames.filter((frame) =>
            [frame.node, ...frame.node.querySelectorAll(SOURCE)].some((part) =>
              readKeys(part).some((key) => {
                const span = readSpanKey(key);

                return (
                  subject.kind === "span" &&
                  span?.path === subject.path &&
                  span.start < subject.end &&
                  span.end > subject.start
                );
              }),
            ),
          );

          return (touched.length === 0 ? sheet.frames : touched).map((frame) => frame.key);
        }),
    ),
  );
}

export function useHover(): Hover {
  const [pointed, setPointed] = useState<string | null>(null);
  const [pointedFrame, setPointedFrame] = useState<string | null>(null);

  return {
    pointed,
    pointedFrame,
    point: (key, frame) => {
      if (key !== pointed) setPointed(key);

      if (frame !== pointedFrame) setPointedFrame(frame);
    },
  };
}

export function Rings(input: {
  readonly host: HTMLElement;
  readonly sheets: readonly SheetBox[];
  readonly placed: ReadonlyMap<string, Point>;
  readonly held: Held | null;
  readonly pointed: string | null;
  readonly lit: string | null;
  readonly readOnly: Element | null;
  readonly refusal: Refusal | null;
  readonly editing: HTMLElement | null;
}): ReactElement {
  const measure = (nodes: readonly Element[]): ReturnType<typeof measureRings> =>
    measureRings(nodes, input.sheets, input.placed, input.held);

  return (
    <>
      {input.pointed !== null &&
        input.pointed !== input.lit &&
        measure(findNodes(input.host, input.pointed)).map((rect, index) => (
          <Ring key={`hover-${String(index)}`} rect={rect} kind="hover" tag={null} />
        ))}
      {input.lit !== null &&
        measure(findNodes(input.host, input.lit)).map((rect, index) => (
          <Ring
            key={`you-${String(index)}`}
            rect={rect}
            kind="you"
            tag={
              input.readOnly !== null && input.readOnly === rect.node
                ? "read-only"
                : index === 0
                  ? input.refusal
                  : null
            }
          />
        ))}
      {input.editing !== null &&
        measure([input.editing]).map((rect) => (
          <Ring key="edit" rect={rect} kind="edit" tag={null} />
        ))}
    </>
  );
}
