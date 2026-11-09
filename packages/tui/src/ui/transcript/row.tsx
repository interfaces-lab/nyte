import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, Match, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import type { ShellJob } from "../../model/state.ts";
import type { PromptRow, Row, TurnModel } from "../../model/transcript.ts";
import { Column } from "./block.tsx";
import { ShellCard } from "./shell-card.tsx";
import { MessageView, TurnView } from "./turn.tsx";

/** One mounted row, looked up by its position among the mounted keys; `key` names it for good. */
export function RowView(props: {
  readonly key: string;
  readonly row: Accessor<Row | undefined>;
  readonly anchor: (node: BoxRenderable) => void;
}): JSX.Element {
  const key = props.key;

  const turn = createMemo(() => {
    const row = props.row();

    return row?.kind === "turn" ? row.turn : undefined;
  });

  const prompt = createMemo(() => {
    const row = props.row();

    return row?.kind === "prompt" ? row : undefined;
  });

  const shell = createMemo(() => {
    const row = props.row();

    return row?.kind === "shell" ? row.job : undefined;
  });

  return (
    <Switch>
      <Match when={turn()}>
        {(model: Accessor<TurnModel>) => <TurnView turn={model} ref={props.anchor} />}
      </Match>
      <Match when={prompt()}>
        {(row: Accessor<PromptRow>) => (
          <Column id={key} ref={props.anchor}>
            <MessageView message={() => row().message} pending={row().pending} />
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
