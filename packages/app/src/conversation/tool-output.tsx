import { Button } from "@nyte-ai/ui/button";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { terminalText } from "./terminal-text.ts";

const EDGE = 16_384;

interface OutputExcerpt {
  readonly head: string;
  readonly tail: string;
  readonly hidden: number;
}

function headEnd(raw: string): number {
  const at = raw.lastIndexOf("\n", EDGE);

  return at > EDGE / 2 ? at + 1 : EDGE;
}

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
