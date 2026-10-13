/** A row drawn as coloured runs: the hint row, the powerline, the moon. */
import type { JSX } from "@opentui/solid";
import { For } from "solid-js";

export interface Chunk {
  readonly fg: string;
  readonly text: string;
}

export function Spans(props: { readonly chunks: readonly Chunk[] }): JSX.Element {
  return (
    <For each={props.chunks}>{(chunk) => <span style={{ fg: chunk.fg }}>{chunk.text}</span>}</For>
  );
}
