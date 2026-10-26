import type { JSX } from "@opentui/solid";
import { For } from "solid-js";
import type { CliTheme } from "../lib/theme.ts";
import type { MiniEntry } from "./transcript.ts";

/** Columns every minimal entry keeps on each side; marks and answers start on the same column. */
export const ENTRY_INSET = 2;

/**
 * A user message, tool or note, as committed to scrollback. It renders outside the app, so it
 * takes its theme as a prop rather than from `useApp`.
 */
export function EntryView(props: {
  readonly entry: Exclude<MiniEntry, { readonly kind: "answer" }>;
  readonly gap: boolean;
  readonly theme: CliTheme;
}): JSX.Element {
  const entry = props.entry;

  const layout = {
    marginLeft: ENTRY_INSET,
    marginRight: ENTRY_INSET,
    marginTop: props.gap ? 1 : 0,
  };

  if (entry.kind === "user")
    return (
      <box {...layout} flexDirection="row">
        <text fg={props.theme.dim} flexShrink={0} wrapMode="none">{`${entry.mark} `}</text>
        <text fg={props.theme.foreground} flexGrow={1} flexShrink={1} wrapMode="word">
          {entry.text}
        </text>
      </box>
    );

  return (
    <text {...layout} wrapMode="word">
      <For each={entry.chunks}>
        {(chunk) => <span style={{ fg: props.theme[chunk.role] }}>{chunk.text}</span>}
      </For>
    </text>
  );
}
