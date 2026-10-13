/** One transcript row by kind. Rows are keyed by string, so a re-derive with the same keys mounts nothing. */
import type { Message } from "@nyte-ai/sdk";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import type { PartMessage } from "../../lib/view-helpers.ts";
import type { ShellJob } from "../../model/state.ts";
import type { Row } from "../../model/transcript.ts";
import { Column } from "./block.tsx";
import { Marker } from "./marker.tsx";
import { useTranscript } from "./scope.tsx";
import { ShellCard } from "./shell-card.tsx";
import { TurnView } from "./turn.tsx";

type TurnRow = Extract<Row, { readonly kind: "turn" }>;

type NoteRow = Extract<Row, { readonly kind: "note" }>;

type ShellRow = Extract<Row, { readonly kind: "shell" }>;

function partOf(message: Message): PartMessage | undefined {
  return message.kind === "part" ? message : undefined;
}

export function RowView(props: {
  readonly row: Row;
  readonly anchor: (node: BoxRenderable) => void;
}): JSX.Element {
  const scope = useTranscript();

  return (
    <Switch>
      <Match when={props.row.kind === "turn" ? props.row : undefined}>
        {(row: Accessor<TurnRow>) => <TurnView id={row().turn} ref={props.anchor} />}
      </Match>
      <Match when={props.row.kind === "note" ? props.row : undefined}>
        {(row: Accessor<NoteRow>) => {
          const note = createMemo(() => {
            const message = scope.model().messages.get(row().message);

            return message === undefined ? undefined : partOf(message);
          });

          return (
            <Column id={row().key} ref={props.anchor}>
              <Show when={note()}>
                {(part: Accessor<PartMessage>) => <Marker message={part()} />}
              </Show>
            </Column>
          );
        }}
      </Match>
      <Match when={props.row.kind === "shell" ? props.row : undefined}>
        {(row: Accessor<ShellRow>) => {
          const job = createMemo(() => scope.model().shells.get(row().job));

          return (
            <Column id={row().key} ref={props.anchor}>
              <Show when={job()}>{(shell: Accessor<ShellJob>) => <ShellCard job={shell()} />}</Show>
            </Column>
          );
        }}
      </Match>
    </Switch>
  );
}
