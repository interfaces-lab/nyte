import type { JSX } from "@opentui/solid";
import { Index } from "solid-js";

export interface Chunk {
  readonly fg: string;
  readonly text: string;
}

export function Spans(props: { readonly chunks: readonly Chunk[] }): JSX.Element {
  return (
    <Index each={props.chunks}>
      {(chunk) => <span style={{ fg: chunk().fg }}>{chunk().text}</span>}
    </Index>
  );
}
