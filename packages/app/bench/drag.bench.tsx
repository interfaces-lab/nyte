import { props } from "@stylexjs/stylex";
import { asId } from "@nyte-ai/schema";
import type { Static } from "typebox";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Prose } from "../src/chat/markdown/prose.tsx";
import { messageScrollerStyles } from "../src/chat/transcript/transcript.stylex.ts";
import { reduceLayout } from "../src/panes/layout.ts";
import type { Layout, PaneId, SplitChild } from "../src/panes/layout.ts";
import { createLayoutStore } from "../src/panes/layout-store.ts";
import { LayoutView, PANE_GAP } from "../src/panes/layout-view.tsx";
import { boxStyle, layoutGeometry } from "../src/panes/pane-geometry.ts";
import { paneRules } from "../src/panes/pane-kinds.ts";
import type { PaneContent } from "../src/panes/pane-kinds.ts";
import { chatContent } from "../src/panes/pane-layout.ts";
import "../src/theme/global.css";
import { DragCase } from "./gates.ts";
import type { DragResult } from "./gates.ts";
import { measure, nextFrame, Page, readCase, SIMD } from "./page.tsx";
import { quantile } from "./stats.ts";

const MOVES = 32;

const RATIO_FROM = 0.4;

const RATIO_TO = 0.6;

const SPLIT = asId<"split">("bench-row");

export async function run(): Promise<string> {
  const benchCase = readCase(DragCase);
  const panes = Array.from({ length: benchCase.panes }, (_, index) =>
    asId<"pane">(`p${String(index)}`),
  );
  const layout = rowLayout(panes);
  const store = createLayoutStore(layout);
  const host = document.createElement("div");
  host.style.display = "flex";
  host.style.width = "1280px";
  host.style.height = "800px";
  document.body.append(host);
  const root = createRoot(host);

  flushSync(() =>
    root.render(
      <Page>
        <LayoutView
          store={store}
          renderTab={(input) => (
            <div data-nyte-scrollport {...props(messageScrollerStyles.viewport)}>
              <div {...props(messageScrollerStyles.content)}>
                <div {...props(messageScrollerStyles.item)}>
                  {panes.indexOf(input.pane) < benchCase.filled && <Prose markdown={SIMD} />}
                </div>
              </div>
            </div>
          )}
        />
      </Page>,
    ),
  );

  const hosts = panes.map((pane) => {
    const element = host.querySelector<HTMLElement>(`[data-nyte-pane-id="${pane}"]`);

    if (element === null) throw new Error(`Expected pane ${pane}`);

    return { pane, element };
  });

  const drag = async () => {
    const moves: number[] = [];

    for (let move = 0; move < MOVES; move += 1) {
      await nextFrame();
      const started = performance.now();
      const ratio = RATIO_FROM + ((RATIO_TO - RATIO_FROM) * move) / (MOVES - 1);
      const lead = (ratio * (panes.length - 1)) / (1 - ratio);
      const sizes = panes.map((_, index) => ({
        kind: "share" as const,
        share: index === 0 ? lead : 1,
      }));
      const geometry = layoutGeometry(
        reduceLayout(layout, { kind: "resize", split: SPLIT, sizes }, paneRules),
      );

      for (const entry of hosts) {
        const box = geometry.panes.get(entry.pane);

        if (box !== undefined) Object.assign(entry.element.style, boxStyle(box, PANE_GAP));
      }

      void host.offsetHeight;
      moves.push(performance.now() - started);
    }

    await nextFrame();

    return { p50Ms: quantile(moves, 0.5), p95Ms: quantile(moves, 0.95) };
  };

  const result: Static<typeof DragResult> = { moves: MOVES, runs: await measure(drag) };
  root.unmount();
  host.remove();

  return JSON.stringify(result);
}

function rowLayout(panes: readonly PaneId[]): Layout<PaneContent> {
  const children = panes.map((pane, index): SplitChild<PaneContent> => {
    const tab = asId<"pane-tab">(`t${String(index)}`);

    return {
      node: {
        kind: "pane",
        id: pane,
        tabs: [{ id: tab, content: chatContent({ kind: "blank" }) }],
        active: tab,
        hidden: false,
      },
      size: { kind: "share", share: 1 },
    };
  });
  const first = children[0];
  const second = children[1];
  const focused = panes[0];

  if (first === undefined || second === undefined || focused === undefined)
    throw new Error("A drag needs two panes.");

  return {
    root: {
      kind: "split",
      id: SPLIT,
      direction: "right",
      children: [first, second, ...children.slice(2)],
    },
    focus: [focused],
    zoomed: null,
  };
}
