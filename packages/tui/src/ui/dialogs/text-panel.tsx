/** Usage, keyboard shortcuts and the plugins report: selectable text in a scrollbox, position line. */
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { keycap } from "../../lib/constants.ts";
import type { TextDialog } from "../../model/dialogs/dialog.ts";
import { hint, joinHints, Note, Panel } from "./panel.tsx";

export function TextPanel(props: { readonly dialog: TextDialog }): JSX.Element {
  const { kit } = useApp();

  const lines = createMemo(() =>
    props.dialog.body.kind === "ready" ? props.dialog.body.lines : [],
  );

  const [viewportRows, setViewportRows] = createSignal(0);
  const nodes: TextRenderable[] = [];
  let scroll: ScrollBoxRenderable | undefined;

  const hints = joinHints([
    hint("picker.close", "close"),
    `${keycap("picker.previous", "symbol")}${keycap("picker.next", "symbol")} scroll`,
    `${keycap("picker.page.up")}/${keycap("picker.page.down")} page`,
    `${keycap("chat.message.previous", "symbol")}/${keycap("chat.message.next", "symbol")} top/end`,
  ]);

  const position = () => {
    const total = lines().length;

    if (total === 0) return "";
    const first = Math.min(total, props.dialog.scroll + 1);
    const last = Math.max(first, Math.min(total, props.dialog.scroll + viewportRows()));

    return `${String(first)}-${String(last)}/${String(total)}${last < total ? " · more below" : " · end"}`;
  };

  const reveal = (): void => {
    const node = nodes[props.dialog.scroll];

    if (scroll === undefined || node === undefined) return;
    scroll.scrollTo(node.getComputedLayout().top);
  };

  createEffect(on(() => props.dialog.scroll, reveal));

  return (
    <Panel title={props.dialog.title} hints={hints} fill>
      <Show
        when={props.dialog.body.kind === "ready"}
        fallback={
          <Note
            text={props.dialog.body.kind === "failed" ? props.dialog.body.message : "Loading…"}
            tone={props.dialog.body.kind === "failed" ? "error" : "dim"}
          />
        }
      >
        <scrollbox
          ref={(box) => {
            scroll = box;
          }}
          flexGrow={1}
          flexShrink={1}
          minHeight={1}
          scrollX={false}
          scrollY
          stickyScroll={false}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: kit.theme().scrollbarTrack,
              foregroundColor: kit.theme().scrollbarThumb,
            },
          }}
          onSizeChange={() => {
            setViewportRows(scroll?.viewport.height ?? 0);
            reveal();
          }}
        >
          <box flexDirection="column">
            <For each={lines()}>
              {(line, index) => (
                <text
                  ref={(node) => {
                    nodes[index()] = node;
                  }}
                  fg={kit.theme().foreground}
                  wrapMode="word"
                >
                  {typeof line === "string" ? (
                    line === "" ? (
                      " "
                    ) : (
                      line
                    )
                  ) : (
                    <For each={line}>
                      {(span) => (
                        <span
                          style={{
                            fg: kit.theme()[span.tone ?? "foreground"],
                            attributes: span.bold ? TextAttributes.BOLD : TextAttributes.NONE,
                          }}
                        >
                          {span.text}
                        </span>
                      )}
                    </For>
                  )}
                </text>
              )}
            </For>
          </box>
        </scrollbox>
      </Show>
      <Note text={position()} />
    </Panel>
  );
}
