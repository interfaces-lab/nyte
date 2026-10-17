import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, keycap } from "../../lib/constants.ts";
import type { CliTheme } from "../../lib/theme.ts";
import { displayWidth, truncateDisplay } from "../../lib/width.ts";
import type { TreeDialog, TreeRow } from "../../model/dialogs/tree.ts";
import { selectedIndex, treeRows } from "../../model/dialogs/tree.ts";
import { revealRow } from "./list.tsx";
import {
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

interface Segment {
  readonly text: string;
  readonly color: string;
}

function roleColor(row: TreeRow, theme: CliTheme): string {
  switch (row.role) {
    case "user":
      return theme.accent;
    case "assistant":
      return theme.ok;
    case "summary":
    case "checkpoint":
      return theme.warning;
    case "tool":
      return theme.dim;
    default: {
      const _exhaustive: never = row.role;

      return _exhaustive;
    }
  }
}

function fit(segments: readonly Segment[], width: number): Segment[] {
  const shown: Segment[] = [];
  let remaining = width;

  for (const segment of segments) {
    if (remaining <= 0 || segment.text === "") continue;
    const text = truncateDisplay(segment.text, remaining, remaining > 1 ? GLYPHS.ellipsis : "");
    shown.push({ ...segment, text });
    remaining -= displayWidth(text);
  }

  return shown;
}

function TreeRowView(props: {
  readonly row: TreeRow;
  readonly index: number;
  readonly selected: boolean;
  readonly width: number;
}): JSX.Element {
  const app = useApp();
  const theme = app.kit.theme;
  const [hovered, setHovered] = createSignal(false);

  const segments = createMemo(() =>
    fit(
      [
        { text: props.row.prefix, color: theme().dim },
        { text: props.row.active ? "• " : "", color: theme().accent },
        ...props.row.heads.map((head) => ({ text: `[${head}] `, color: theme().warning })),
        { text: props.row.label, color: roleColor(props.row, theme()) },
        { text: props.row.text === "" ? "" : ` ${props.row.text}`, color: theme().foreground },
      ],
      props.width - PREFIX_WIDTH,
    ),
  );

  return (
    <text
      height={1}
      width="100%"
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      bg={props.selected ? theme().selectionBackground : hovered() ? theme().hover : undefined}
      attributes={props.selected ? TextAttributes.BOLD : TextAttributes.NONE}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        app.dispatch({ kind: "dialog", command: { kind: "pick", index: props.index } });
      }}
    >
      <span style={{ fg: props.selected ? theme().selectionForeground : theme().accent }}>
        {props.selected ? `${GLYPHS.prompt} ` : "  "}
      </span>
      <For each={segments()}>
        {(segment) => (
          <span style={{ fg: props.selected ? theme().selectionForeground : segment.color }}>
            {segment.text}
          </span>
        )}
      </For>
    </text>
  );
}

export function TreeView(props: { readonly dialog: TreeDialog }): JSX.Element {
  const width = useBodyWidth();
  const cap = useRowCap();
  const tree = createMemo(() => props.dialog.tree);
  const filter = createMemo(() => props.dialog.filter);
  const query = createMemo(() => props.dialog.query);
  const folded = createMemo(() => props.dialog.folded);

  const rows = createMemo(() =>
    treeRows({ tree: tree(), filter: filter(), query: query(), folded: folded() }),
  );

  const selected = createMemo(() => selectedIndex(props.dialog, rows()));

  const empty = () => {
    const loaded = tree();

    if (loaded.kind === "loading") return { text: "Loading…", tone: "dim" as const };

    if (loaded.kind === "failed") return { text: loaded.message, tone: "error" as const };

    return { text: "No entries found", tone: "dim" as const };
  };

  const help = joinHints([
    `${keycap("tree.page.up", "symbol")}/${keycap("tree.page.down", "symbol")} page`,
    `${keycap("tree.fold", "symbol").replace("meta+", "alt+")}/${keycap("tree.unfold", "symbol").replace("meta+", "")} fold`,
    hint("tree.copy", "copy"),
    `${keycap("tree.filter.tools")}/${keycap("tree.filter.users").replace("ctrl+", "")}/${keycap("tree.filter.all").replace("ctrl+", "")}/${keycap("tree.filter.default").replace("ctrl+", "")} filter`,
    hint("tree.filter.next", "cycle"),
  ]);

  const hints = joinHints([
    hint("picker.accept", "select"),
    moveHint(),
    hint("tree.close", "close"),
  ]);

  const footer = () => {
    const total = rows().length;
    const position = total === 0 ? 0 : selected() + 1;
    const mode = props.dialog.filter === "default" ? "" : ` [${props.dialog.filter}]`;

    return `  (${String(position)}/${String(total)})${mode}`;
  };

  let scroll: ScrollBoxRenderable | undefined;
  createEffect(on(selected, (index) => revealRow(scroll, index)));

  return (
    <Panel title="Chat Tree" hints={hints}>
      <Note text={help} />
      <QueryLine
        text={props.dialog.query}
        caret={props.dialog.caret}
        anchor={props.dialog.anchor}
        placeholder="type to filter"
      />
      <Show when={rows().length > 0} fallback={<Note text={empty().text} tone={empty().tone} />}>
        <scrollbox
          ref={(box) => {
            scroll = box;
            const reveal = () => revealRow(box, selected());
            box.viewport.on("resize", reveal);
            onCleanup(() => box.viewport.off("resize", reveal));
          }}
          height={Math.min(rows().length, cap())}
          scrollX={false}
          scrollY
          scrollbarOptions={{ visible: false }}
        >
          <For each={rows()}>
            {(row, index) => (
              <TreeRowView
                row={row}
                index={index()}
                selected={index() === selected()}
                width={width()}
              />
            )}
          </For>
        </scrollbox>
      </Show>
      <Note text={footer()} />
    </Panel>
  );
}
