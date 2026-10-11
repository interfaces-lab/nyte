import { branchSummary, compaction, text, thinking, tool } from "@nyte-ai/core";
import type { Renderer } from "@nyte-ai/core";
import type { ReactNode } from "react";
import { canvas } from "../canvas.ts";
import type { Plugin } from "../client.ts";
import { question } from "../question.ts";
import { view } from "./view.ts";

/** Returns what a part whose state fails its schema draws. */
const unreadable = (kind: string): ReactNode => <div data-part={kind}>This {kind} part cannot be shown.</div>;

/**
 * Renderers for React clients, the desktop and the web: the five built-in
 * part kinds, `ask/question` and `canvas`. Each draws a part's state; the
 * tool's Stop, the question's choices and the canvas's Add box call `act`.
 *
 * @category plugins
 * @since 0.1.0
 */
export const reactRenderers: readonly Renderer[] = [
  view(text, "react", (state) => <div data-part="text">{state.markdown}</div>, unreadable),
  view(
    thinking,
    "react",
    (state) => (
      <details data-part="thinking">
        <summary>Thinking</summary>
        {state.markdown}
      </details>
    ),
    unreadable,
  ),
  view(
    tool,
    "react",
    (state, act) => (
      <div data-part="tool" data-phase={state.phase}>
        <span>{state.class.kind === "custom" ? state.class.label : state.name}</span>
        {state.phase === "settled" ? <span>{state.outcome.kind}</span> : <button onClick={() => void act("stop", {})}>Stop</button>}
      </div>
    ),
    unreadable,
  ),
  view(
    compaction,
    "react",
    (state) => <div data-part="compaction">{state.summary ?? `Context compacted at ${state.tokensBefore} tokens.`}</div>,
    unreadable,
  ),
  view(branchSummary, "react", (state) => <div data-part="branchSummary">{state.markdown}</div>, unreadable),
  view(
    question,
    "react",
    (state, act) => (
      <div data-part="ask/question" role="dialog" aria-label={state.prompt}>
        <p>{state.prompt}</p>
        {state.options.map((choice) => (
          <button key={choice} onClick={() => void act("answer", { choice })}>
            {choice}
          </button>
        ))}
      </div>
    ),
    unreadable,
  ),
  view(
    canvas,
    "react",
    (state, act) => (
      <figure data-part="canvas">
        <svg viewBox="0 0 100 100">
          {state.shapes.map((shape, index) =>
            shape.kind === "ellipse" ? (
              <ellipse
                key={index}
                cx={shape.x + shape.width / 2}
                cy={shape.y + shape.height / 2}
                rx={shape.width / 2}
                ry={shape.height / 2}
                fill={shape.color ?? "none"}
                stroke="currentColor"
              />
            ) : shape.kind === "line" ? (
              <line key={index} x1={shape.x} y1={shape.y} x2={shape.x + shape.width} y2={shape.y + shape.height} stroke={shape.color ?? "currentColor"} />
            ) : shape.kind === "text" ? (
              <text key={index} x={shape.x} y={shape.y}>
                {shape.label}
              </text>
            ) : (
              <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color ?? "none"} stroke="currentColor" />
            ),
          )}
        </svg>
        <button onClick={() => void act("draw", { shapes: [{ kind: "rect", x: 10 * (state.shapes.length % 9), y: 10, width: 10, height: 10 }] })}>
          Add box
        </button>
      </figure>
    ),
    unreadable,
  ),
];

/**
 * The React renderers as a client plugin.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "renderers-react",
  contribute: { renderers: reactRenderers },
} satisfies Plugin;
