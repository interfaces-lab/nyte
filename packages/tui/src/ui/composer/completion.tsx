import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { displayWidth, padDisplay, truncateDisplay } from "../../lib/width.ts";
import type { CompletionModel } from "../../model/completion.ts";

const MAX_ROWS = 10;

const CHROME_ROWS = 6;

const CHROME_COLUMNS = 5;

const PREFIX_WIDTH = 2;

const LABEL_GAP = 4;

const DETAIL_MIN_WIDTH = 43;

const EMPTY: Readonly<Record<CompletionModel["token"]["trigger"], string>> = {
  "/": "no matching commands",
  "@": "no matching files or folders",
  cd: "no matching directories",
  argument: "no suggestions",
};

export function CompletionMenu(props: { readonly model: CompletionModel }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const theme = () => app.kit.theme();
  const visible = () => Math.max(1, Math.min(MAX_ROWS, dimensions().height - CHROME_ROWS));
  const width = () => Math.max(1, dimensions().width - CHROME_COLUMNS);

  const window = createMemo(() => {
    const { items, highlighted } = props.model;
    const size = visible();
    const first = Math.max(0, Math.min(highlighted - size + 1, items.length - size));

    return items
      .slice(first, first + size)
      .map((item, offset) => ({ item, index: first + offset }));
  });

  const labelWidth = () =>
    Math.max(
      1,
      Math.min(
        width() - PREFIX_WIDTH,
        Math.max(0, ...window().map(({ item }) => displayWidth(item.label))),
      ),
    );

  const detailWidth = () =>
    width() < DETAIL_MIN_WIDTH ? 0 : width() - PREFIX_WIDTH - labelWidth() - LABEL_GAP;

  return (
    <box
      id="completion"
      flexDirection="column"
      flexShrink={0}
      marginLeft={1}
      marginRight={1}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <Show
        when={props.model.items.length > 0}
        fallback={
          <text fg={theme().dim}>
            {props.model.loading ? "loading directories…" : EMPTY[props.model.token.trigger]}
          </text>
        }
      >
        <For each={window()}>
          {(entry) => {
            const selected = () => entry.index === props.model.highlighted;
            const [hovered, setHovered] = createSignal(false);

            const foreground = () =>
              selected() ? theme().selectionForeground : theme().foreground;

            return (
              <text
                id={`completion-${entry.item.id}`}
                height={1}
                wrapMode="none"
                truncate
                selectable={false}
                bg={
                  selected() ? theme().selectionBackground : hovered() ? theme().hover : undefined
                }
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                }}
                onMouseUp={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  app.dispatch({
                    kind: "completion",
                    action: { kind: "pick", index: entry.index },
                  });
                }}
              >
                <span style={{ fg: foreground() }}>{selected() ? `${GLYPHS.prompt} ` : "  "}</span>
                <span
                  style={{
                    fg: foreground(),
                    attributes: selected() ? TextAttributes.BOLD : TextAttributes.NONE,
                  }}
                >
                  {padDisplay(
                    truncateDisplay(entry.item.label, labelWidth(), GLYPHS.ellipsis),
                    labelWidth(),
                  )}
                </span>
                <Show when={entry.item.detail !== "" && detailWidth() > 0}>
                  <span style={{ fg: selected() ? theme().selectionForeground : theme().dim }}>
                    {`${" ".repeat(LABEL_GAP)}${truncateDisplay(entry.item.detail, detailWidth(), GLYPHS.ellipsis)}`}
                  </span>
                </Show>
              </text>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
