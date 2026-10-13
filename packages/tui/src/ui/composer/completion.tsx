/** The completion dropdown: rows from `CompletionModel`, highlight, click to pick. */
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, For, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { displayWidth, padDisplay, truncateDisplay } from "../../lib/width.ts";
import type { CompletionModel } from "../../model/completion.ts";

const MAX_ROWS = 10;

/** The rows the slot keeps for the composer and the chrome around the menu. */
const CHROME_ROWS = 6;

const MAX_LABEL_COLUMNS = 32;

const EMPTY: Readonly<Record<CompletionModel["token"]["trigger"], string>> = {
  "/": "no matching commands",
  "@": "no matching files",
  cd: "no matching directories",
};

export function CompletionMenu(props: { readonly model: CompletionModel }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const theme = () => app.kit.theme();
  const visible = () => Math.max(1, Math.min(MAX_ROWS, dimensions().height - CHROME_ROWS));

  const window = createMemo(() => {
    const { items, highlighted } = props.model;
    const size = visible();
    const first = Math.max(0, Math.min(highlighted - size + 1, items.length - size));

    return items
      .slice(first, first + size)
      .map((item, offset) => ({ item, index: first + offset }));
  });

  const labelWidth = () =>
    Math.min(
      MAX_LABEL_COLUMNS,
      Math.max(0, ...window().map(({ item }) => displayWidth(item.label))),
    );

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
        fallback={<text fg={theme().dim}>{EMPTY[props.model.token.trigger]}</text>}
      >
        <For each={window()}>
          {(entry) => {
            const selected = () => entry.index === props.model.highlighted;

            return (
              <text
                id={`completion-${entry.item.id}`}
                height={1}
                wrapMode="none"
                truncate
                selectable={false}
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
                <span style={{ fg: theme().accent }}>
                  {selected() ? `${GLYPHS.prompt} ` : "  "}
                </span>
                <span style={{ fg: selected() ? theme().accent : theme().foreground }}>
                  {padDisplay(
                    truncateDisplay(entry.item.label, labelWidth(), GLYPHS.ellipsis),
                    labelWidth(),
                  )}
                </span>
                <span style={{ fg: theme().dim }}>
                  {entry.item.detail === "" ? "" : `    ${entry.item.detail}`}
                </span>
              </text>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
