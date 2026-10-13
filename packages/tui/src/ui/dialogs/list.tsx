/** The one list view: title, search line, rows (❯, mark, label, description · status), typed-answer row, count, hint line. */
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { displayWidth, padDisplay } from "../../lib/width.ts";
import type { Choice, ListDialog } from "../../model/dialogs/list.ts";
import {
  acceptLabel,
  answeringActive,
  cancelLabel,
  emptyLabel,
  listActions,
  typedLabel,
  visibleChoices,
} from "../../model/dialogs/list.ts";
import {
  cut,
  hint,
  joinHints,
  moveHint,
  Note,
  Panel,
  QueryLine,
  useBodyWidth,
  useRowCap,
} from "./panel.tsx";

/** `❯ ` plus the gap between the label column and the detail. */
const PREFIX_WIDTH = 2;

const MARK_WIDTH = 2;

const LABEL_GAP = 4;

/** Below this width, a complete label is worth more than a clipped detail column, and the count goes. */
const DETAIL_MIN_WIDTH = 43;

interface Detail {
  readonly head: string;
  readonly tail: string;
  readonly tone: "muted" | "ok" | "warning" | "error";
}

function detailOf(choice: Choice): string {
  const separator = choice.description === "" || choice.status === null ? "" : " · ";

  return `${choice.description}${separator}${choice.status?.text ?? ""}`;
}

/** Scrolls the least that brings row `index` into the box's viewport. */
export function revealRow(box: ScrollBoxRenderable | undefined, index: number): void {
  if (box === undefined) return;
  const height = box.viewport.height;

  if (height <= 0) return;
  const top = box.scrollTop;

  if (index < top) box.scrollTo(index);
  else if (index >= top + height) box.scrollTo(index - height + 1);
}

function ListRow(props: {
  readonly choice: Choice;
  readonly index: number;
  readonly selected: boolean;
  readonly marked: boolean;
  readonly labelColumn: number;
  readonly width: number;
}): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;
  const foreground = () => (props.selected ? theme().selectionForeground : theme().foreground);
  const markWidth = () => (props.marked ? MARK_WIDTH : 0);
  const [hovered, setHovered] = createSignal(false);

  /** The detail cut to its column; the status keeps its tone where it survived the cut. */
  const detail = createMemo((): Detail | null => {
    const text = detailOf(props.choice);
    const room = props.width - PREFIX_WIDTH - markWidth() - props.labelColumn - LABEL_GAP;

    if (props.width < DETAIL_MIN_WIDTH || text === "" || room <= 0) return null;
    const shown = cut(text, room);
    const { status } = props.choice;
    const lead = text.length - (status?.text.length ?? 0);

    if (status === null || status.tone === "muted" || shown.length <= lead)
      return { head: shown, tail: "", tone: "muted" as const };

    return { head: shown.slice(0, lead), tail: shown.slice(lead), tone: status.tone };
  });

  return (
    <text
      height={1}
      width="100%"
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      bg={props.selected ? theme().selectionBackground : hovered() ? theme().hover : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        app.dispatch({ kind: "dialog", command: { kind: "pick", index: props.index } });
      }}
    >
      <span style={{ fg: foreground() }}>{props.selected ? `${GLYPHS.prompt} ` : "  "}</span>
      <Show when={props.marked}>
        <span style={{ fg: theme()[props.choice.mark?.tone ?? "muted"] }}>
          {padDisplay(cut(props.choice.mark?.glyph ?? "", MARK_WIDTH), MARK_WIDTH)}
        </span>
      </Show>
      <span
        style={{
          fg: foreground(),
          attributes: props.selected ? TextAttributes.BOLD : TextAttributes.NONE,
        }}
      >
        {padDisplay(cut(props.choice.label, props.labelColumn), props.labelColumn)}
      </span>
      <Show when={detail()}>
        {(shown: Accessor<Detail>) => (
          <>
            <span style={{ fg: props.selected ? theme().selectionForeground : theme().dim }}>
              {`${" ".repeat(LABEL_GAP)}${shown().head}`}
            </span>
            <span
              style={{ fg: props.selected ? theme().selectionForeground : theme()[shown().tone] }}
            >
              {shown().tail}
            </span>
          </>
        )}
      </Show>
    </text>
  );
}

export function ListView(props: { readonly dialog: ListDialog }): JSX.Element {
  const app = useApp();
  const width = useBodyWidth();
  const cap = useRowCap();
  const rows = createMemo(() => visibleChoices(props.dialog));
  const typed = () => typedLabel(props.dialog.purpose);
  const answering = () => answeringActive(props.dialog);
  const marked = createMemo(() => rows().some((choice) => choice.mark !== null));

  const labelColumn = createMemo(() => {
    const widest = rows().reduce((max, choice) => Math.max(max, displayWidth(choice.label)), 0);

    return Math.max(1, Math.min(widest, width() - PREFIX_WIDTH - (marked() ? MARK_WIDTH : 0)));
  });

  const total = () =>
    props.dialog.choices.kind === "ready" ? props.dialog.choices.items.length : 0;

  const count = () =>
    props.dialog.choices.kind !== "ready" ||
    typed() !== null ||
    width() < DETAIL_MIN_WIDTH ||
    props.dialog.busy
      ? ""
      : rows().length === total()
        ? ` ${String(total())}`
        : ` ${String(rows().length)}/${String(total())}`;

  const empty = () => {
    const { choices } = props.dialog;

    if (choices.kind === "loading") return { text: "Loading…", tone: "dim" as const };

    if (choices.kind === "failed") return { text: choices.message, tone: "error" as const };

    return {
      text: choices.items.length === 0 ? emptyLabel(props.dialog.purpose) : "No matches",
      tone: "dim" as const,
    };
  };

  const hints = () =>
    joinHints([
      hint("picker.accept", acceptLabel(props.dialog.purpose)),
      ...listActions(props.dialog.purpose).map((action) => hint(action.command, action.label)),
      moveHint(),
      hint("picker.close", cancelLabel(props.dialog.purpose)),
    ]);

  let scroll: ScrollBoxRenderable | undefined;

  createEffect(
    on(
      () => props.dialog.highlighted,
      (highlighted) => revealRow(scroll, Math.min(highlighted, rows().length - 1)),
    ),
  );

  return (
    <Panel title={props.dialog.title} hints={hints()}>
      <Show when={typed() === null}>
        <QueryLine
          text={props.dialog.query}
          caret={props.dialog.caret}
          placeholder="type to filter"
          trailing={count()}
          active={!props.dialog.busy}
        />
      </Show>
      <Show when={rows().length > 0} fallback={<Note text={empty().text} tone={empty().tone} />}>
        <scrollbox
          ref={(box) => {
            scroll = box;
          }}
          maxHeight={cap()}
          scrollX={false}
          scrollY
          scrollbarOptions={{ visible: false }}
          onSizeChange={() => revealRow(scroll, props.dialog.highlighted)}
        >
          <For each={rows()}>
            {(choice, index) => (
              <ListRow
                choice={choice}
                index={index()}
                selected={!answering() && index() === props.dialog.highlighted}
                marked={marked()}
                labelColumn={labelColumn()}
                width={width()}
              />
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={typed()}>
        {(placeholder: Accessor<string>) => (
          <QueryLine
            marker
            text={props.dialog.answering ?? ""}
            caret={props.dialog.caret}
            placeholder={placeholder()}
            active={answering()}
            onClick={() =>
              app.dispatch({
                kind: "dialog",
                command: { kind: "highlight", index: rows().length },
              })
            }
          />
        )}
      </Show>
    </Panel>
  );
}
