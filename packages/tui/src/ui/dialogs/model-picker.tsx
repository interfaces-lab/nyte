/** Model rows, effort/fast fields, the responsive detail pane, "↑ more above / ↓ more below". */
import { TextAttributes } from "@opentui/core";
import type { Thinking } from "@nyte-ai/sdk";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { modelId } from "../../lib/catalog.ts";
import { GLYPHS, keycap } from "../../lib/constants.ts";
import { padDisplay } from "../../lib/width.ts";
import type { ModelDialog, ModelRow } from "../../model/dialogs/model-picker.ts";
import {
  activeField,
  currentRowId,
  modelFields,
  rowDraft,
  visibleModels,
} from "../../model/dialogs/model-picker.ts";
import { cut, hint, joinHints, Note, Panel, QueryLine, useBodyWidth } from "./panel.tsx";

/** Rows the picker may spend below its title and search line, bounded by the terminal. */
const MAX_BODY_ROWS = 18;

const CHROME_ROWS = 10;

function effortLabel(level: Thinking): string {
  return level === "xhigh" ? "XHigh" : level[0].toUpperCase() + level.slice(1);
}

function price(rate: number): string {
  return `$${String(rate)} / 1M`;
}

function arrows(text: string): string {
  return `${keycap("model.decrease", "symbol")} ${text} ${keycap("model.increase", "symbol")}`;
}

function Row(props: {
  readonly dialog: ModelDialog;
  readonly row: ModelRow;
  readonly index: number;
  readonly selected: boolean;
  readonly current: boolean;
  readonly width: number;
}): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;
  const color = () => (props.selected ? theme().accent : theme().foreground);
  const field = () => (props.selected ? activeField(props.dialog, props.row) : null);
  const draft = createMemo(() => rowDraft(props.dialog, props.row));
  const wide = () => props.width >= 62;

  const label = () => {
    const labelWidth = Math.max(1, wide() ? Math.min(34, props.width - 45) : props.width - 16);

    return padDisplay(cut(props.row.info.name || props.row.ref.id, labelWidth), labelWidth);
  };

  const effort = () => {
    const levels = props.row.info.thinking;
    const level = draft().effort;
    const bars = "■".repeat(level === "off" ? 0 : Math.max(0, levels.indexOf(level) + 1));
    const empty = "□".repeat(Math.max(0, levels.length - bars.length));

    return wide()
      ? `${padDisplay(bars + empty, 7)} ${padDisplay(effortLabel(level), 7)}`
      : effortLabel(level);
  };

  const fast = () =>
    props.row.info.fast === null ? "" : `Fast mode ${draft().fast ? "On" : "Off"}`;

  return (
    <text
      height={1}
      width="100%"
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      bg={props.selected ? theme().selectionBackground : undefined}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        app.dispatch({ kind: "dialog", command: { kind: "highlight", index: props.index } });
      }}
    >
      <span style={{ fg: color() }}>
        {props.selected ? `${GLYPHS.prompt} ` : props.current ? "· " : "  "}
      </span>
      <span
        style={{
          fg: color(),
          attributes: props.selected ? TextAttributes.BOLD : TextAttributes.NONE,
        }}
      >
        {label()}
      </span>
      <span style={{ fg: field() === "effort" ? theme().accent : theme().dim }}>
        {`  ${field() === "effort" ? arrows(effort()) : `  ${effort()}  `}`}
      </span>
      <Show when={wide() && fast() !== ""}>
        <span style={{ fg: field() === "fast" ? theme().accent : theme().dim }}>
          {`  ${field() === "fast" ? arrows(fast()) : `  ${fast()}`}`}
        </span>
      </Show>
    </text>
  );
}

function Details(props: {
  readonly dialog: ModelDialog;
  readonly row: ModelRow;
  readonly rows: number;
  readonly width: number;
}): JSX.Element {
  const { kit } = useApp();
  const theme = kit.theme;
  const draft = createMemo(() => rowDraft(props.dialog, props.row));
  const level = () => effortLabel(draft().effort);

  const fast = () =>
    props.row.info.fast === null ? "" : ` · Fast mode ${draft().fast ? "On" : "Off"}`;

  const meterWidth = () => Math.min(34, props.width);
  const column = () => Math.max(1, Math.min(17, Math.floor(props.width / 3)));

  const cells = (values: readonly string[]): string =>
    values.map((value) => padDisplay(cut(value, column()), column())).join("");

  const ceiling = () =>
    props.dialog.models.kind === "ready" ? props.dialog.models.list.costCeiling : 0;

  const position = () => {
    const { cost } = props.row.info;

    return ceiling() === 0 || draft().fast
      ? -1
      : Math.round(((meterWidth() - 1) * (cost.input + cost.output)) / ceiling());
  };

  const rates = () =>
    draft().fast
      ? ["Unavailable", "Unavailable", "Unavailable"]
      : [props.row.info.cost.input, props.row.info.cost.cacheRead, props.row.info.cost.output].map(
          (rate) => price(Number(rate.toPrecision(10))),
        );

  const caption = () =>
    draft().fast
      ? "Fast-mode pricing unavailable"
      : `${String(props.row.info.contextWindow / 1000)}k context · USD per million tokens`;

  return (
    <Show
      when={props.rows >= 6}
      fallback={<Note text={cut(`${level()}${fast()} · ${props.row.ref.provider}`, props.width)} />}
    >
      <box flexDirection="column" flexShrink={0} height={6}>
        <Note text={cut(`${modelId(props.row.ref)} · ${level()}${fast()}`, props.width)} />
        <text height={1} wrapMode="none" selectable={false}>
          <For each={Array.from({ length: meterWidth() }, (_, index) => index)}>
            {(index) => (
              <span style={{ fg: index < meterWidth() / 2 ? theme().ok : theme().thinking }}>
                {index === position() ? "●" : "─"}
              </span>
            )}
          </For>
        </text>
        <Note text={cells(["Input", "Cached input", "Output"])} />
        <text height={1} wrapMode="none" selectable={false} fg={theme().foreground}>
          {cells(rates())}
        </text>
        <Note text={cut(caption(), props.width)} />
      </box>
    </Show>
  );
}

export function ModelPickerView(props: { readonly dialog: ModelDialog }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const width = useBodyWidth();
  const rows = createMemo(() => visibleModels(props.dialog));

  const total = () =>
    props.dialog.models.kind === "ready" ? props.dialog.models.list.rows.length : 0;

  const budget = () => Math.max(1, Math.min(MAX_BODY_ROWS, dimensions().height - CHROME_ROWS));
  const detailRows = () => (budget() >= 9 ? 6 : budget() >= 4 ? 1 : 0);
  const markers = () => (budget() >= 4 ? 2 : 0);

  const visibleCount = () =>
    Math.max(1, Math.min(budget() - detailRows() - markers(), Math.max(1, rows().length)));

  const [offset, setOffset] = createSignal(0);

  const start = createMemo(() => {
    const count = visibleCount();
    const { highlighted } = props.dialog;
    const clamped = Math.max(0, Math.min(offset(), highlighted, rows().length - count));

    return highlighted >= clamped + count ? highlighted - count + 1 : clamped;
  });

  createEffect(() => setOffset(start()));
  const shown = createMemo(() => rows().slice(start(), start() + visibleCount()));
  const selected = () => rows()[props.dialog.highlighted];

  const current = createMemo(() =>
    props.dialog.models.kind === "ready"
      ? currentRowId(props.dialog.models.list.rows, props.dialog.current)
      : modelId(props.dialog.current),
  );

  const empty = () => {
    const { models } = props.dialog;

    if (models.kind === "loading") return { text: "Loading models…", tone: "dim" as const };

    if (models.kind === "failed")
      return { text: "Could not load models. Close and try /model again.", tone: "error" as const };

    return {
      text:
        models.list.rows.length === 0
          ? "No models available. Use /login to connect a provider."
          : "No matching models",
      tone: "dim" as const,
    };
  };

  const hints = () => {
    const row = selected();
    const fields = row === undefined ? 0 : modelFields(row).length;
    const active = row === undefined ? null : activeField(props.dialog, row);
    const move = `${keycap("model.previous", "symbol")}${keycap("model.next", "symbol")}`;
    const change = `${keycap("model.decrease", "symbol")}${keycap("model.increase", "symbol")}`;

    if (width() + 5 < 80)
      return joinHints([
        move,
        ...(active === null ? [] : [`${change} ${active}`]),
        ...(fields > 1 ? [keycap("model.field.cycle")] : []),
        hint("picker.accept", "confirm", "symbol"),
        keycap("picker.close"),
      ]);

    return joinHints([
      `${move} select`,
      ...(fields > 1
        ? [hint("model.field.cycle", active === "effort" ? "fast mode" : "reasoning effort")]
        : []),
      ...(active === null
        ? []
        : [`${change} ${active === "effort" ? "reasoning effort" : "fast mode"}`]),
      hint("picker.accept", "confirm"),
      hint("picker.close", "cancel"),
    ]);
  };

  return (
    <Panel title="Models" hints={hints()}>
      <QueryLine
        text={props.dialog.query}
        caret={props.dialog.caret}
        placeholder="Type to search"
        trailing={width() >= 35 ? ` ${String(rows().length)}/${String(total())}` : ""}
      />
      <Show when={markers() > 0}>
        <Note text={start() > 0 ? "  ↑ more above" : ""} />
      </Show>
      <Show when={rows().length > 0} fallback={<Note text={empty().text} tone={empty().tone} />}>
        <box
          flexDirection="column"
          flexShrink={0}
          onMouseScroll={(event) => {
            const direction = event.scroll?.direction;

            if (direction !== "up" && direction !== "down") return;
            event.preventDefault();
            event.stopPropagation();
            app.dispatch({
              kind: "dialog",
              command: { kind: "key", name: direction === "up" ? "model.previous" : "model.next" },
            });
          }}
        >
          <For each={shown()}>
            {(row, index) => (
              <Row
                dialog={props.dialog}
                row={row}
                index={start() + index()}
                selected={start() + index() === props.dialog.highlighted}
                current={modelId(row.ref) === current()}
                width={width()}
              />
            )}
          </For>
        </box>
      </Show>
      <Show when={markers() > 0}>
        <Note text={start() + visibleCount() < rows().length ? "  ↓ more below" : ""} />
      </Show>
      <Show when={detailRows() > 0 && selected()}>
        {(row: Accessor<ModelRow>) => (
          <Details dialog={props.dialog} row={row()} rows={detailRows()} width={width()} />
        )}
      </Show>
    </Panel>
  );
}
