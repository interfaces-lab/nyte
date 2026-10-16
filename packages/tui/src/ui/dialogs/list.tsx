import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, keycap } from "../../lib/constants.ts";
import { formatTiming } from "../../lib/format.ts";
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

const PREFIX_WIDTH = 2;

const MARK_WIDTH = 2;

const LABEL_GAP = 4;

const DETAIL_MIN_WIDTH = 43;

interface Detail {
  readonly head: string;
  readonly tail: string;
  readonly tone: "muted" | "ok" | "warning" | "error";
}

const CLOCK_INTERVAL_MS = 1_000;

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
  readonly now: number;
}): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;
  const foreground = () => (props.selected ? theme().selectionForeground : theme().foreground);
  const markWidth = () => (props.marked ? MARK_WIDTH : 0);
  const [hovered, setHovered] = createSignal(false);

  const detail = createMemo((): Detail | null => {
    const { timing, description, status } = props.choice;

    const text = [
      timing === null ? "" : formatTiming(timing, props.now),
      description,
      status?.text ?? "",
    ]
      .filter((part) => part !== "")
      .join(" · ");

    const room = props.width - PREFIX_WIDTH - markWidth() - props.labelColumn - LABEL_GAP;

    if (props.width < DETAIL_MIN_WIDTH || text === "" || room <= 0) return null;
    const shown = cut(text, room);
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
  const question = () => props.dialog.purpose.kind === "question";
  const [detailContentRows, setDetailContentRows] = createSignal(1);
  const detailText = createMemo(() => props.dialog.title);
  const detailSequence = createMemo(() => props.dialog.detailScroll?.seq);
  const detailRows = () => Math.min(detailContentRows(), Math.max(1, Math.floor(cap() / 2)));
  const detailOverflows = () => question() && detailContentRows() > detailRows();
  const choiceRows = () =>
    Math.max(1, cap() - (question() ? detailRows() : 0) - (detailOverflows() ? 1 : 0));
  let detail: ScrollBoxRenderable | undefined;
  const rows = createMemo(() => visibleChoices(props.dialog));
  const typed = () => typedLabel(props.dialog.purpose);
  const answering = () => answeringActive(props.dialog);
  const marked = createMemo(() => rows().some((choice) => choice.mark !== null));
  const ticking = createMemo(() => rows().some((choice) => choice.timing?.endedAt === null));
  const [now, setNow] = createSignal(app.kit.now());

  createEffect(() => {
    if (!ticking()) return;
    const tick = app.kit.ticker(CLOCK_INTERVAL_MS);

    createEffect(() => {
      tick();
      setNow(app.kit.now());
    });
  });

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

  createEffect(on(detailText, () => detail?.scrollTo(0)));

  createEffect(
    on(detailSequence, () => {
      const request = props.dialog.detailScroll;

      if (request !== undefined && detail !== undefined)
        detail.scrollBy(request.by * Math.max(1, detail.viewport.height / 2));
    }),
  );

  return (
    <Panel title={question() ? "Question" : props.dialog.title} hints={hints()}>
      <Show when={question()}>
        <scrollbox
          ref={(box) => {
            detail = box;
          }}
          height={detailRows()}
          flexShrink={0}
          scrollX={false}
          scrollY
          stickyScroll={false}
          scrollbarOptions={{ visible: false }}
        >
          <box
            flexDirection="column"
            flexShrink={0}
            onSizeChange={function () {
              setDetailContentRows(this.height);
            }}
          >
            <text fg={app.kit.theme().foreground} wrapMode="word">
              {props.dialog.title}
            </text>
          </box>
        </scrollbox>
      </Show>
      <Show when={detailOverflows()}>
        <Note text={`${keycap("picker.detail.up")}/${keycap("picker.detail.down")} question`} />
      </Show>
      <Show when={typed() === null && props.dialog.purpose.kind !== "question"}>
        <QueryLine
          text={props.dialog.query}
          caret={props.dialog.caret}
          anchor={props.dialog.anchor}
          placeholder="type to filter"
          trailing={count()}
          active={!props.dialog.busy}
        />
      </Show>
      <Show when={rows().length > 0} fallback={<Note text={empty().text} tone={empty().tone} />}>
        <scrollbox
          ref={(box) => {
            scroll = box;
            const reveal = () => revealRow(box, props.dialog.highlighted);
            box.viewport.on("resize", reveal);
            onCleanup(() => box.viewport.off("resize", reveal));
          }}
          height={Math.min(rows().length, choiceRows())}
          scrollX={false}
          scrollY
          scrollbarOptions={{ visible: false }}
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
                now={now()}
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
            anchor={props.dialog.anchor}
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
