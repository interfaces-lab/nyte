import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, Match, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import type { PartMessage, UserMessage } from "../../lib/view-helpers.ts";
import type { ShellJob } from "../../model/state.ts";
import type { Row, TurnModel } from "../../model/transcript.ts";
import { Column } from "./block.tsx";
import { Marker } from "./marker.tsx";
import { ShellCard } from "./shell-card.tsx";
import { MessageView, TurnView } from "./turn.tsx";

export function RowView(props: {
  readonly row: Accessor<Row>;
  readonly anchor: (node: BoxRenderable) => void;
}): JSX.Element {
  const key = props.row().key;

  const turn = createMemo(() => {
    const row = props.row();

    return row.kind === "turn" ? row.turn : undefined;
  });

  const note = createMemo(() => {
    const row = props.row();

    return row.kind === "note" ? row.message : undefined;
  });

  const landing = createMemo(() => {
    const row = props.row();

    return row.kind === "landing" ? row.message : undefined;
  });

  const shell = createMemo(() => {
    const row = props.row();

    return row.kind === "shell" ? row.job : undefined;
  });

  return (
    <Switch>
      <Match when={turn()}>
        {(model: Accessor<TurnModel>) => <TurnView turn={model} ref={props.anchor} />}
      </Match>
      <Match when={note()}>
        {(message: Accessor<PartMessage>) => (
          <Column id={key} ref={props.anchor}>
            <Marker message={message()} />
          </Column>
        )}
      </Match>
      <Match when={landing()}>
        {(message: Accessor<UserMessage>) => (
          <Column id={key} ref={props.anchor}>
            <MessageView message={message} />
          </Column>
        )}
      </Match>
      <Match when={shell()}>
        {(job: Accessor<ShellJob>) => (
          <Column id={key} ref={props.anchor}>
            <ShellCard job={job()} />
          </Column>
        )}
      </Match>
    </Switch>
  );
}
