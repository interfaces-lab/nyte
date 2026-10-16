import { Button } from "@nyte-ai/ui/button";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { terminalText } from "./terminal-text.ts";

/** Raw characters a row reads from each end of a tool's output before the user asks for the rest. */
const EDGE = 16_384;

/**
 * A tool's output as a row draws it at mount. Short output is whole. Longer
 * output keeps its first and last `EDGE` characters, cut at a line break near
 * the edge, and only those two slices are rendered as terminal text; `hidden`
 * counts the raw characters left between them. A 5 MB log costs the same as a
 * 32 KB one until someone asks for all of it.
 */
interface OutputExcerpt {
  readonly head: string;
  readonly tail: string;
  readonly hidden: number;
}

/** Where the head ends: the last line break in its second half, else the edge itself. */
function headEnd(raw: string): number {
  const at = raw.lastIndexOf("\n", EDGE);

  return at > EDGE / 2 ? at + 1 : EDGE;
}

/** Where the tail starts: the line break nearest before the edge, if it is close, else the edge itself. */
function tailStart(raw: string): number {
  const edge = raw.length - EDGE;
  const at = raw.lastIndexOf("\n", edge);

  return at > edge - EDGE / 2 ? at + 1 : edge;
}

export function outputExcerpt(raw: string): OutputExcerpt {
  if (raw.length <= EDGE * 2) return { head: terminalText(raw), tail: "", hidden: 0 };
  const end = headEnd(raw);
  const start = tailStart(raw);

  return {
    head: terminalText(raw.slice(0, end)),
    tail: terminalText(raw.slice(start)),
    hidden: start - end,
  };
}

/** The excerpt as one string, with an ellipsis line where the middle was left out. */
export function excerptText(excerpt: OutputExcerpt): string {
  return excerpt.hidden === 0 ? excerpt.head : `${excerpt.head}…\n${excerpt.tail}`;
}

function sizeLabel(characters: number): string {
  return characters >= 1_048_576
    ? `${(characters / 1_048_576).toFixed(1)} MB`
    : `${String(Math.ceil(characters / 1024))} KB`;
}

function WholeOutput({ raw }: { readonly raw: string }): string {
  return useMemo(() => terminalText(raw), [raw]);
}

/**
 * An output body: the excerpt, with a control between head and tail that
 * renders the whole output. Only that press reads the full text.
 */
export function ToolOutputText({
  raw,
  excerpt,
}: {
  readonly raw: string;
  readonly excerpt: OutputExcerpt;
}): ReactNode {
  const [whole, setWhole] = useState(false);

  if (excerpt.hidden === 0) return excerpt.head;

  if (whole) return <WholeOutput raw={raw} />;

  return (
    <>
      {excerpt.head}
      <Button size="sm" variant="outline" onClick={() => setWhole(true)}>
        Show {sizeLabel(excerpt.hidden)} more
      </Button>
      {"\n"}
      {excerpt.tail}
    </>
  );
}
