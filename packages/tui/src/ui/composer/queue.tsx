import type { MessageId } from "@nyte-ai/sdk";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, pendingHint } from "../../lib/constants.ts";
import { displayWidth } from "../../lib/width.ts";
import type { CliTheme } from "../../lib/theme.ts";
import type { Intent } from "../../model/msg.ts";
import { placeLabel } from "../../model/queue.ts";
import type { Place, QueueRow } from "../../model/queue.ts";

const MAX_ROW_SHARE = 0.3;

const MIN_TEXT_COLUMNS = 12;

const FIXED_COLUMNS = 2 + 3 + 1;

const GAP_COLUMNS = 2;

type ReorderTo = Extract<Intent, { readonly kind: "reorder" }>["to"];

function dropTarget(
  rows: readonly QueueRow[],
  dragged: MessageId,
  onto: MessageId,
): ReorderTo | null {
  const pending = rows.flatMap((row) => (row.withdrawable ? [row.id] : []));
  const from = pending.findIndex((id) => id === dragged);
  const to = pending.findIndex((id) => id === onto);

  if (from === -1 || to === -1 || from === to) return null;

  return { before: to < from ? onto : (pending[to + 1] ?? null) };
}

interface RowMark {
  readonly glyph: string;
  readonly tone: string;
}

function placeMark(place: Place, theme: CliTheme): RowMark {
  switch (place.kind) {
    case "joining":
      return { glyph: GLYPHS.steer, tone: theme.accent };
    case "next-turn":
    case "attached":
      return { glyph: GLYPHS.queue, tone: theme.warning };
    case "sending":
      return { glyph: GLYPHS.sending, tone: theme.dim };
    case "uncovered":
    case "deciding":
      return { glyph: GLYPHS.queue, tone: theme.dim };
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

function Line(props: {
  readonly id: string;
  readonly glyph: string;
  readonly tone: string;
  readonly text: string;
  readonly textTone: string;
  readonly label: string;
  readonly hint: string | null;
  readonly onMouseDown?: () => void;
  readonly onMouseDrag?: () => void;
  readonly onMouseUp?: () => void;
  readonly onMouseDrop?: () => void;
}): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const [hovered, setHovered] = createSignal(false);
  const theme = () => app.kit.theme();

  const fits = (right: string): boolean =>
    dimensions().width - FIXED_COLUMNS - GAP_COLUMNS - displayWidth(right) >= MIN_TEXT_COLUMNS;

  const label = () => (fits(props.label) ? props.label : null);

  const hint = () =>
    props.hint !== null && fits(`${props.label} · ${props.hint}`) ? props.hint : null;

  return (
    <box
      id={props.id}
      flexDirection="row"
      height={1}
      flexShrink={0}
      backgroundColor={hovered() ? theme().hover : theme().terminal}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        props.onMouseDown?.();
      }}
      onMouseDrag={(event) => {
        event.preventDefault();
        props.onMouseDrag?.();
      }}
      onMouseUp={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        props.onMouseUp?.();
      }}
      onMouseDrop={(event) => {
        event.preventDefault();
        props.onMouseDrop?.();
      }}
    >
      <text fg={props.tone} flexShrink={0} wrapMode="none" selectable={false}>
        {` ${props.glyph} `}
      </text>
      <text
        fg={props.textTone}
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
        wrapMode="none"
        truncate
        selectable={false}
      >
        {props.text}
      </text>
      <text flexShrink={0} wrapMode="none" selectable={false}>
        <Show when={label()}>
          {(shown: Accessor<string>) => (
            <>
              <span style={{ fg: theme().muted }}>{"  "}</span>
              <span style={{ fg: props.tone }}>{shown()}</span>
            </>
          )}
        </Show>
        <Show when={hint()}>
          {(shown: Accessor<string>) => (
            <>
              <span style={{ fg: theme().muted }}>{" · "}</span>
              <span style={{ fg: theme().dim }}>{shown()}</span>
            </>
          )}
        </Show>
        <span style={{ fg: theme().muted }}> </span>
      </text>
    </box>
  );
}

function QueueLine(props: {
  readonly row: QueueRow;
  readonly hint: string | null;
  readonly onPress: () => void;
  readonly onMove: () => void;
  readonly onRelease: () => void;
  readonly onDrop: () => void;
}): JSX.Element {
  const app = useApp();
  const mark = () => placeMark(props.row.place, app.kit.theme());

  return (
    <Line
      id={`queue-row-${props.row.id}`}
      glyph={mark().glyph}
      tone={mark().tone}
      text={props.row.text}
      textTone={app.kit.theme().user}
      label={props.row.editing ? "editing" : placeLabel(props.row.place)}
      hint={props.hint}
      onMouseDown={props.onPress}
      onMouseDrag={props.onMove}
      onMouseUp={props.onRelease}
      onMouseDrop={props.onDrop}
    />
  );
}

export function QueueRows(): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  let drag: { readonly id: MessageId; moved: boolean } | null = null;

  const limit = () => Math.max(1, Math.floor(dimensions().height * MAX_ROW_SHARE));
  const queue = createMemo(() => app.screen().queue.slice(0, limit()));
  const hidden = () => app.screen().queue.length - queue().length;

  const hintFor = (index: number): string | null =>
    index === queue().length - 1 ? pendingHint(hidden()) : null;

  return (
    <box
      id="pending-rows"
      flexDirection="column"
      flexShrink={0}
      marginLeft={1}
      marginRight={1}
      visible={queue().length > 0}
    >
      <For each={queue()}>
        {(row, index) => (
          <QueueLine
            row={row}
            hint={hintFor(index())}
            onPress={() => {
              drag = { id: row.id, moved: false };
            }}
            onMove={() => {
              if (drag !== null) drag.moved = true;
            }}
            onRelease={() => {
              if (drag === null || drag.id !== row.id || drag.moved) return;
              drag = null;
              app.dispatch({
                kind: "open",
                dialog: { kind: "list", purpose: { kind: "queue", message: row.id } },
              });
            }}
            onDrop={() => {
              const dragged = drag;
              drag = null;

              if (dragged === null || !dragged.moved) return;
              const to = dropTarget(app.screen().queue, dragged.id, row.id);

              if (to !== null) app.dispatch({ kind: "reorder", message: dragged.id, to });
            }}
          />
        )}
      </For>
    </box>
  );
}
