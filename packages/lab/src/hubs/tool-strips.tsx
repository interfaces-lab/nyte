/**
 * Strips for the tool pages: an editor mid-diff, a terminal typing its next
 * command over falling glyphs, a globe that turns behind its tracker shield,
 * and a trace waterfall with a playhead sweeping the turn.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { useReducedMotion } from "motion/react";
import { useContext, type ReactElement } from "react";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { rounded } from "./hub-art";
import { BOARD, Falloff, Strip, ink, seeded } from "./strip";

type Token = "key" | "name" | "text" | "punct";

interface CodeLine {
  readonly indent: number;
  readonly tokens: readonly (readonly [Token, number])[];
  readonly diff?: "added" | "removed";
}

const CODE: readonly CodeLine[] = [
  {
    indent: 0,
    tokens: [
      ["key", 30],
      ["name", 44],
      ["punct", 8],
      ["text", 60],
    ],
  },
  {
    indent: 0,
    tokens: [
      ["key", 22],
      ["name", 54],
      ["punct", 10],
    ],
  },
  {
    indent: 1,
    tokens: [
      ["key", 26],
      ["name", 40],
      ["punct", 6],
      ["name", 52],
    ],
    diff: "added",
  },
  {
    indent: 1,
    tokens: [
      ["name", 34],
      ["punct", 6],
      ["text", 70],
    ],
    diff: "added",
  },
  {
    indent: 2,
    tokens: [
      ["key", 30],
      ["name", 48],
    ],
  },
  {
    indent: 1,
    tokens: [
      ["punct", 8],
      ["name", 40],
      ["text", 36],
    ],
    diff: "removed",
  },
  {
    indent: 1,
    tokens: [
      ["key", 34],
      ["name", 28],
      ["punct", 6],
    ],
  },
  { indent: 0, tokens: [["punct", 10]] },
];

const EDITOR = {
  x: 410,
  y: 26,
  w: 380,
  h: 148,
  gutter: 440,
  code: 460,
  top: 66,
  line: 13,
} as const;

const CURSOR_LINE = 4;

const TOKEN_INK = {
  key: ink.accentFill,
  name: ink.secondaryFill,
  text: ink.tertiaryFill,
  punct: ink.strongFill,
} as const;

const TEXTURE = (() => {
  const random = seeded(17);

  return Array.from({ length: 16 }, (_, row) => {
    const y = 10 + row * 12.5;
    let x = 10 + random() * 30;
    const tokens: { x: number; w: number }[] = [];

    while (x < BOARD.w) {
      const w = 12 + random() * 46;
      const inside = x + w > EDITOR.x - 16 && x < EDITOR.x + EDITOR.w + 16 && y > 14 && y < 186;

      if (!inside) tokens.push({ x, w });
      x += w + 5 + (random() > 0.85 ? 40 : 0);
    }

    return { y, tokens };
  });
})();

function lineTokens(
  line: CodeLine,
): readonly { readonly kind: Token; readonly x: number; readonly w: number }[] {
  let x = EDITOR.code + line.indent * 14;

  return line.tokens.map(([kind, w]) => {
    const token = { kind, x, w };
    x += w + 5;

    return token;
  });
}

export function EditorStrip(): ReactElement {
  const falloff = useContext(Falloff);
  const cursorEnd = lineTokens(CODE[CURSOR_LINE] ?? { indent: 0, tokens: [] }).at(-1);
  const cursorX = cursorEnd === undefined ? EDITOR.code : cursorEnd.x + cursorEnd.w + 3;
  const cursorY = EDITOR.top + CURSOR_LINE * EDITOR.line;

  return (
    <Strip tint="yellow">
      <g mask={`url(#${falloff})`}>
        {TEXTURE.flatMap((row) =>
          row.tokens.map((token) => (
            <rect
              key={`${row.y},${token.x}`}
              x={token.x}
              y={row.y}
              width={token.w}
              height={4}
              rx={2}
              {...props(ink.mutedFill)}
            />
          )),
        )}
      </g>
      <rect
        x={EDITOR.x}
        y={EDITOR.y}
        width={EDITOR.w}
        height={EDITOR.h}
        rx={12}
        {...props(ink.solid)}
      />
      <rect
        x={EDITOR.x + 10}
        y={EDITOR.y + 7}
        width={86}
        height={18}
        rx={5}
        {...props(editor.tab)}
      />
      <text
        x={EDITOR.x + 20}
        y={EDITOR.y + 19}
        {...props(ink.mono, ink.primaryFill, editor.tabText)}
      >
        hub-art.tsx
      </text>
      <circle cx={EDITOR.x + 86} cy={EDITOR.y + 16} r={2.4} {...props(ink.accentFill)} />
      <text
        x={EDITOR.x + 110}
        y={EDITOR.y + 19}
        {...props(ink.mono, ink.tertiaryFill, editor.tabText)}
      >
        scenes.ts
      </text>
      <path
        d={`M${EDITOR.x},${EDITOR.y + 32} L${EDITOR.x + EDITOR.w},${EDITOR.y + 32}`}
        {...props(ink.faint)}
      />

      {CODE.map((line, index) => {
        const y = EDITOR.top + index * EDITOR.line;

        return (
          <g
            key={index}
            {...props(
              line.diff === "added" && intent.success,
              line.diff === "removed" && intent.danger,
            )}
          >
            {line.diff !== undefined && (
              <>
                <rect
                  x={EDITOR.x + 1}
                  y={y - 6.5}
                  width={EDITOR.w - 34}
                  height={EDITOR.line}
                  {...props(editor.diffRow)}
                />
                <rect
                  x={EDITOR.gutter + 6}
                  y={y - 6.5}
                  width={2.5}
                  height={EDITOR.line}
                  {...props(ink.accentFill)}
                />
              </>
            )}
            {index === CURSOR_LINE && (
              <rect
                x={EDITOR.x + 1}
                y={y - 6.5}
                width={EDITOR.w - 34}
                height={EDITOR.line}
                {...props(editor.lineHighlight)}
              />
            )}
            <text
              x={EDITOR.gutter}
              y={y + 2.5}
              {...props(ink.mono, ink.tertiaryFill, editor.number)}
            >
              {index + 1}
            </text>
            {lineTokens(line).map((token) => (
              <rect
                key={token.x}
                x={token.x}
                y={y - 2.5}
                width={token.w}
                height={5}
                rx={2.5}
                {...props(
                  line.diff === undefined ? TOKEN_INK[token.kind] : ink.accentFill,
                  line.diff !== undefined && token.kind !== "key" && editor.diffToken,
                )}
              />
            ))}
          </g>
        );
      })}
      <rect
        x={cursorX - 1}
        y={cursorY - 6}
        width={1.6}
        height={12}
        {...props(ink.primaryFill, editor.caret)}
      />
      <text x={cursorX + 10} y={cursorY + 2.5} {...props(ink.mono, ink.tertiaryFill, editor.blame)}>
        Ada Halden · 2h ago · tighten wires
      </text>

      <rect
        x={EDITOR.x + EDITOR.w - 26}
        y={EDITOR.y + 40}
        width={16}
        height={34}
        rx={3}
        {...props(editor.viewport)}
      />
      {CODE.map((line, index) =>
        lineTokens(line).map((token) => (
          <rect
            key={`${index},${token.x}`}
            x={EDITOR.x + EDITOR.w - 24 + (token.x - EDITOR.code) * 0.08}
            y={EDITOR.y + 44 + index * 3.4}
            width={Math.max(1, token.w * 0.08)}
            height={1.6}
            {...props(token.kind === "key" ? ink.accentFill : ink.strongFill)}
          />
        )),
      )}
    </Strip>
  );
}

const TERMINAL = { x: 420, y: 30, w: 360, h: 140, text: 438, advance: 5.4 } as const;

const TYPED = "nyte serve --remote";

const RAIN = (() => {
  const random = seeded(3);
  const glyphs = "01∙▪abcdef$#>";

  return Array.from({ length: 36 }, (_, index) => {
    const west = index < 18;
    const x = west ? 14 + index * 20 : 846 + (index - 18) * 20;

    const cycle = Array.from(
      { length: 8 },
      () => glyphs[Math.floor(random() * glyphs.length)] ?? "0",
    ).join("");

    return {
      x,
      text: cycle.repeat(4),
      opacity: 0.2 + random() * 0.5,
      speed: (["slow", "medium", "fast"] as const)[Math.floor(random() * 3)] ?? "slow",
      delay: `${(-random() * 6).toFixed(2)}s`,
    };
  });
})();

export function TerminalStrip(): ReactElement {
  const falloff = useContext(Falloff);
  const typedFrom = TERMINAL.text + 2 * TERMINAL.advance;
  const typedWidth = TYPED.length * TERMINAL.advance;

  return (
    <Strip tint="green" caption="zsh — 80×24">
      <g mask={`url(#${falloff})`}>
        {RAIN.map((column) => (
          <text
            key={column.x}
            x={column.x}
            y={-80}
            opacity={column.opacity}
            {...props(
              ink.mono,
              ink.accentFill,
              terminal.rain,
              terminal[column.speed],
              terminal.delay(column.delay),
            )}
          >
            {column.text}
          </text>
        ))}
      </g>
      <rect
        x={TERMINAL.x}
        y={TERMINAL.y}
        width={TERMINAL.w}
        height={TERMINAL.h}
        rx={12}
        {...props(ink.solid)}
      />
      {[0, 1, 2].map((index) => (
        <circle
          key={index}
          cx={TERMINAL.x + 16 + index * 11}
          cy={TERMINAL.y + 12}
          r={3}
          {...props(ink.strongFill)}
        />
      ))}
      <text x={BOARD.cx} y={TERMINAL.y + 15} {...props(ink.mono, ink.tertiaryFill, terminal.title)}>
        ~/nyte — zsh
      </text>
      <path
        d={`M${TERMINAL.x},${TERMINAL.y + 24} L${TERMINAL.x + TERMINAL.w},${TERMINAL.y + 24}`}
        {...props(ink.faint)}
      />

      <g {...props(ink.mono, terminal.line)}>
        <text x={TERMINAL.text} y={74}>
          <tspan {...props(ink.accentFill)}>$</tspan>
          <tspan {...props(ink.secondaryFill)}> pnpm --dir packages/lab test</tspan>
        </text>
        <text x={TERMINAL.text} y={88}>
          <tspan {...props(ink.accentFill)}>✓</tspan>
          <tspan {...props(ink.tertiaryFill)}> 128 passed · 1.8s</tspan>
        </text>
        <text x={TERMINAL.text} y={106}>
          <tspan {...props(ink.accentFill)}>$</tspan>
          <tspan {...props(ink.secondaryFill)}> git push</tspan>
        </text>
        <text x={TERMINAL.text} y={120}>
          <tspan {...props(ink.tertiaryFill)}> main → origin/main</tspan>
        </text>
        <text x={TERMINAL.text} y={142} {...props(ink.accentFill)}>
          $
        </text>
        <text
          x={typedFrom}
          y={142}
          textLength={typedWidth}
          lengthAdjust="spacingAndGlyphs"
          {...props(ink.primaryFill)}
        >
          {TYPED}
        </text>
      </g>
      <g {...props(terminal.typing)}>
        <rect x={typedFrom} y={131} width={typedWidth + 12} height={16} {...props(ink.baseFill)} />
        <rect
          x={typedFrom}
          y={133}
          width={TERMINAL.advance}
          height={11}
          {...props(ink.accentFill, terminal.cursor)}
        />
      </g>
    </Strip>
  );
}

const GLOBE = { r: 70, seconds: 14 } as const;

const MERIDIANS = 6;

const TRACKERS = (() => {
  const random = seeded(8);

  return Array.from({ length: 7 }, () => ({
    x: 392 + random() * 110,
    y: 30 + random() * 140,
  }));
})();

/** A meridian's half-width as it turns: |sin| sampled over half a turn, so the loop is seamless. */
const SWING = Array.from({ length: 25 }, (_, index) =>
  (GLOBE.r * Math.abs(Math.sin((Math.PI * index) / 24))).toFixed(2),
).join(";");

export function BrowserStrip(): ReactElement {
  const still = useReducedMotion() === true;
  const falloff = useContext(Falloff);

  return (
    <Strip tint="blue">
      <g mask={`url(#${falloff})`}>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const west = index < 3;
          const x = west ? 60 + index * 92 : 880 + (index - 3) * 92;
          const y = 36 + ((index * 53) % 120);

          return (
            <g key={index} transform={`translate(${x} ${y})`}>
              <rect width={84} height={22} rx={11} {...props(ink.solid)} />
              <circle
                cx={12}
                cy={11}
                r={4}
                {...props(index % 2 === 0 ? ink.accentFill : ink.strongFill)}
              />
              <rect
                x={22}
                y={9}
                width={44 - (index % 3) * 8}
                height={4}
                rx={2}
                {...props(ink.mutedFill)}
              />
            </g>
          );
        })}
      </g>

      <g {...props(intent.danger)}>
        {TRACKERS.map((tracker) => (
          <g key={`${tracker.x},${tracker.y}`}>
            <path
              d={`M${tracker.x},${tracker.y} L${BOARD.cx - GLOBE.r - 14},${BOARD.cy + (tracker.y - BOARD.cy) * 0.4}`}
              {...props(ink.faint, browser.blockedTrail)}
            />
            <circle cx={tracker.x} cy={tracker.y} r={5} {...props(ink.solid, browser.tracker)} />
            <path
              d={`M${tracker.x - 2},${tracker.y - 2} L${tracker.x + 2},${tracker.y + 2} M${tracker.x + 2},${tracker.y - 2} L${tracker.x - 2},${tracker.y + 2}`}
              {...props(ink.accent, browser.cross)}
            />
          </g>
        ))}
      </g>
      <circle
        cx={BOARD.cx}
        cy={BOARD.cy}
        r={GLOBE.r + 14}
        {...props(ink.accent, browser.barrier)}
      />

      <circle cx={BOARD.cx} cy={BOARD.cy} r={GLOBE.r} {...props(ink.solid)} />
      {[-60, -30, 0, 30, 60].map((latitude) => {
        const radians = (latitude * Math.PI) / 180;
        const rx = GLOBE.r * Math.cos(radians);

        return (
          <ellipse
            key={latitude}
            cx={BOARD.cx}
            cy={BOARD.cy - GLOBE.r * Math.sin(radians)}
            rx={rx}
            ry={rx * 0.14}
            {...props(latitude === 0 ? ink.accent : ink.strong)}
          />
        );
      })}
      {Array.from({ length: MERIDIANS }, (_, index) => (
        <ellipse
          key={index}
          cx={BOARD.cx}
          cy={BOARD.cy}
          rx={GLOBE.r * Math.abs(Math.sin((Math.PI * (index + 0.5)) / MERIDIANS))}
          ry={GLOBE.r}
          {...props(ink.strong)}
        >
          {!still && (
            <animate
              attributeName="rx"
              values={SWING}
              dur={`${GLOBE.seconds}s`}
              begin={`${(-(index / MERIDIANS) * GLOBE.seconds).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          )}
        </ellipse>
      ))}

      <g transform={`rotate(-14 ${BOARD.cx} ${BOARD.cy})`}>
        <ellipse
          cx={BOARD.cx}
          cy={BOARD.cy}
          rx={118}
          ry={28}
          {...props(ink.accent, browser.ring)}
        />
        <g transform={still ? `translate(${BOARD.cx + 100} ${BOARD.cy - 15})` : undefined}>
          {!still && (
            <animateMotion
              dur="9s"
              repeatCount="indefinite"
              path={`M${BOARD.cx - 118},${BOARD.cy} a118,28 0 1,0 236,0 a118,28 0 1,0 -236,0`}
            />
          )}
          <g transform="rotate(14)">
            <path
              d="M-4,-7 L7,3 L1.6,3.4 L4.4,9 L2,10 L-0.8,4.4 L-4,8 Z"
              {...props(ink.primaryFill, browser.pointer)}
            />
          </g>
        </g>
      </g>

      <g transform="translate(652 132)">
        <path
          d="M0,-18 L15,-12 L15,1 C15,11 8,17 0,20 C-8,17 -15,11 -15,1 L-15,-12 Z"
          {...props(ink.solid, browser.shield)}
        />
        <path d="M-6,1 L-1.5,5.5 L7,-4" {...props(ink.accent, browser.check)} />
      </g>
    </Strip>
  );
}

interface Span {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly depth: number;
  readonly critical: boolean;
}

const SPANS: readonly Span[] = [
  { from: 380, to: 820, name: "agent.turn", depth: 0, critical: true },
  { from: 392, to: 540, name: "model.stream", depth: 1, critical: true },
  { from: 548, to: 610, name: "tool.read", depth: 1, critical: false },
  { from: 556, to: 604, name: "fs.stat", depth: 2, critical: false },
  { from: 616, to: 748, name: "tool.bash", depth: 1, critical: true },
  { from: 626, to: 696, name: "pnpm test", depth: 2, critical: true },
  { from: 702, to: 744, name: "git diff", depth: 2, critical: false },
  { from: 756, to: 818, name: "model.stream", depth: 1, critical: false },
];

const TRACE = { ruler: 30, top: 44, row: 15, height: 10 } as const;

const GHOST_SPANS = (() => {
  const random = seeded(44);

  return Array.from({ length: 30 }, (_, index) => {
    const west = index % 2 === 0;
    const row = Math.floor(random() * 8);
    const w = 24 + random() * 110;
    const x = west ? 10 + random() * (330 - w) : 870 + random() * (320 - w);

    return { x, w, y: TRACE.top + row * TRACE.row };
  });
})();

function findParent(index: number): Span | undefined {
  const span = SPANS[index];

  if (span === undefined) return undefined;

  return SPANS.slice(0, index).findLast((candidate) => candidate.depth === span.depth - 1);
}

export function AdvancedStrip(): ReactElement {
  const falloff = useContext(Falloff);

  return (
    <Strip tint="red">
      <path d={`M0,${TRACE.ruler} L${BOARD.w},${TRACE.ruler}`} {...props(ink.strong)} />
      {Array.from({ length: 61 }, (_, index) => {
        const x = index * 20;
        const major = (x - 380) % 55 === 0;

        return (
          <path
            key={index}
            d={`M${x},${TRACE.ruler} L${x},${TRACE.ruler - 3}`}
            {...props(major ? ink.line : ink.faint)}
          />
        );
      })}
      {Array.from({ length: 9 }, (_, index) => (
        <g key={index}>
          <path
            d={`M${380 + index * 55},${TRACE.ruler} L${380 + index * 55},${TRACE.ruler - 6}`}
            {...props(ink.line)}
          />
          <text
            x={380 + index * 55}
            y={TRACE.ruler - 10}
            {...props(ink.mono, ink.tertiaryFill, advanced.tick)}
          >
            {index * 25}ms
          </text>
          <path
            d={`M${380 + index * 55},${TRACE.ruler + 4} L${380 + index * 55},176`}
            {...props(ink.faint, advanced.grid)}
          />
        </g>
      ))}

      <g mask={`url(#${falloff})`}>
        {GHOST_SPANS.map((span) => (
          <rect
            key={`${span.x},${span.y}`}
            x={span.x}
            y={span.y}
            width={span.w}
            height={TRACE.height}
            rx={3}
            {...props(ink.mutedFill)}
          />
        ))}
      </g>

      {SPANS.map((span, index) => {
        const parent = findParent(index);
        const y = TRACE.top + index * TRACE.row;

        const parentY =
          TRACE.top + SPANS.findIndex((candidate) => candidate === parent) * TRACE.row;

        return parent === undefined ? null : (
          <path
            key={`link-${span.name}-${span.from}`}
            d={rounded(
              [
                { x: parent.from + 4, y: parentY + TRACE.height },
                { x: parent.from + 4, y: y + TRACE.height / 2 },
                { x: span.from, y: y + TRACE.height / 2 },
              ],
              3,
              false,
            )}
            {...props(ink.strong)}
          />
        );
      })}
      {SPANS.map((span, index) => {
        const y = TRACE.top + index * TRACE.row;

        return (
          <g key={`${span.name}-${span.from}`}>
            <rect
              x={span.from}
              y={y}
              width={span.to - span.from}
              height={TRACE.height}
              rx={3}
              {...props(span.critical ? ink.strongAccentFill : ink.solid)}
            />
            <text
              x={span.from + 5}
              y={y + 7.4}
              {...props(
                ink.mono,
                span.critical ? ink.inverseFill : ink.secondaryFill,
                advanced.label,
              )}
            >
              {span.name}
            </text>
          </g>
        );
      })}

      <g {...props(advanced.playhead)}>
        <path d={`M380,${TRACE.ruler} L380,176`} {...props(ink.accent)} />
        <path
          d={`M375,${TRACE.ruler - 7} L385,${TRACE.ruler - 7} L380,${TRACE.ruler} Z`}
          {...props(ink.accentFill)}
        />
      </g>
    </Strip>
  );
}

const blink = keyframes({ "0%, 49%": { opacity: 1 }, "50%, 100%": { opacity: 0 } });

const fall = keyframes({
  from: { transform: "translateY(0)" },
  to: { transform: "translateY(80px)" },
});

const typing = keyframes({
  "0%": { transform: "translateX(0)" },
  "70%, 100%": { transform: `translateX(${String(TYPED.length * TERMINAL.advance)}px)` },
});

const sweep = keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(440px)" },
});

const reduced = "@media (prefers-reduced-motion: reduce)";

const editor = create({
  tab: { fill: role.bgMuted, stroke: role.borderPrimary, strokeWidth: 1 },
  tabText: { fontSize: 7.5 },
  number: { fontSize: 7, textAnchor: "end", fontVariantNumeric: "tabular-nums" },
  diffRow: { fill: role.bgInteractivePrimaryTranslucent },
  diffToken: { opacity: 0.55 },
  lineHighlight: { fill: role.bgMutedTranslucent },
  caret: {
    animationName: { default: blink, [reduced]: "none" },
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
  },
  blame: { fontSize: 7, opacity: 0.8 },
  viewport: { fill: role.bgMutedTranslucent, stroke: role.borderPrimary, strokeWidth: 0.8 },
});

const terminal = create({
  rain: {
    fontSize: 9,
    writingMode: "vertical-lr",
    textOrientation: "upright",
    letterSpacing: "1px",
    animationName: { default: fall, [reduced]: "none" },
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  slow: { animationDuration: "9s" },
  medium: { animationDuration: "6s" },
  fast: { animationDuration: "4s" },
  delay: (delay: string) => ({ animationDelay: delay }),
  title: { fontSize: 7.5, textAnchor: "middle" },
  line: { fontSize: 9, whiteSpace: "pre" },
  typing: {
    animationName: { default: typing, [reduced]: "none" },
    animationDuration: "4.2s",
    animationIterationCount: "infinite",
    animationTimingFunction: `steps(${String(TYPED.length)}, end)`,
  },
  cursor: {
    animationName: { default: blink, [reduced]: "none" },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

const browser = create({
  blockedTrail: { strokeDasharray: "2 3", opacity: 0.8 },
  tracker: { stroke: role.chartSeries },
  cross: { strokeWidth: 1.4 },
  barrier: { strokeWidth: 1, strokeDasharray: "1 4", opacity: 0.8 },
  ring: { strokeWidth: 1, strokeDasharray: "3 4" },
  pointer: { stroke: role.bgBase, strokeWidth: 1 },
  shield: { stroke: role.chartSeries, strokeWidth: 1.6 },
  check: { strokeWidth: 2 },
});

const advanced = create({
  tick: { fontSize: 7, textAnchor: "middle", fontVariantNumeric: "tabular-nums" },
  grid: { strokeDasharray: "1 4" },
  label: { fontSize: 7 },
  playhead: {
    animationName: { default: sweep, [reduced]: "none" },
    animationDuration: "6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
});
