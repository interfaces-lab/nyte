import { definePlugin } from "@nyte-ai/core/plugins";
import { CanvasInputSchema, type CanvasSnapshot } from "../src/canvas/wire.ts";

export function canvasPlugin(options: {
  readonly compile: (source: string) => Promise<string>;
  readonly store: (input: {
    readonly title: string;
    readonly code: string;
    readonly runtime: 1;
  }) => Promise<CanvasSnapshot>;
}) {
  return definePlugin({
    id: "canvas",
    session(api) {
      api.prompt.add((draft) =>
        draft.set("canvas", {
          text: "When a chart or diagram says more than prose, call canvas before your final reply. It appears inline above your reply. Keep the reply short and do not restate the visual.",
        }),
      );
      api.tools.add("canvas", {
        description: `Publish an inline React canvas. Send title and source, a TSX module with a default-exported React component. Import only react and nyte:canvas. Use SVG for diagrams. No network or external assets.
SDK: BarChart, LineChart, PieChart. All accept data: {label: string, value: number}[], height?: number (fixed pixels, default 240), title?: string (accessible name only; the canvas title is shown above it). Width is fluid; axes, gridlines and hover are built in. LineChart also accepts area?: boolean (default false), points?: boolean (default true). PieChart accepts innerRadius?: number (pixels, default 0; use 70 for a donut with the total in the middle). Custom markup inherits the theme: style it with CSS variables --canvas-fg, --canvas-muted, --canvas-subtle, --canvas-grid, --canvas-border, --canvas-surface, --canvas-chart-1 through --canvas-chart-6, --canvas-font. The page background is transparent and already themed; do not add an outer card, border or heading.
Example: import { BarChart } from "nyte:canvas"; export default function Canvas() { return <BarChart title="Releases" data={[{label:"North",value:42},{label:"South",value:31}]} />; }
If compilation fails, fix the named line and call canvas again. After publishing, do not repeat the chart in prose.`,
        parameters: CanvasInputSchema,
        label: "Canvas",
        replay: "safe",
        execute: async (input) => {
          const code = await options.compile(input.source);
          const snapshot = await options.store({ title: input.title, code, runtime: 1 });

          return {
            content: [
              {
                type: "text",
                text: `canvas:${snapshot.id}\n${snapshot.title} is shown above your reply. Do not restate it.`,
              },
            ],
            details: undefined,
            title: snapshot.title,
          };
        },
      });
    },
  });
}
