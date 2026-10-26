import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import {
  BOARD,
  CELL,
  Chip,
  FRAME_COUNT,
  Field,
  Frame,
  Frames,
  Label,
  Level,
  Strip,
  ink,
  noise,
  plot,
  spectrum,
} from "./strip";

type Token = "key" | "name" | "text" | "punct";

type Tokens = readonly (readonly [Token, number])[];

interface Line {
  readonly indent: number;
  readonly tokens: Tokens;
  readonly diff?: "added" | "removed";
}

/** Keywords take the most saturated ink, names the brightest, strings and punctuation recede. */
const TOKEN_STRENGTH: Readonly<Record<Token, number>> = {
  key: 0.75,
  name: 1,
  text: 0.5,
  punct: 0.28,
};

/** A plausible line of code for the file around the change: a keyword or a name, then a few tokens. */
function sketch(indent: number | null, seed: number): Line {
  if (indent === null) return { indent: 0, tokens: [] };
  const count = 2 + Math.floor(noise(seed, 1) * 6);

  const tokens = Array.from({ length: count }, (_, step): readonly [Token, number] => {
    const pick = noise(seed, step + 9);
    const opener: Token = pick < 0.5 ? "key" : "name";
    const later: Token = pick < 0.45 ? "name" : pick < 0.7 ? "punct" : pick < 0.85 ? "text" : "key";
    const kind = step === 0 ? opener : later;

    return [
      kind,
      kind === "punct" ? 1 + Math.floor(pick * 3) : 2 + Math.floor(noise(seed, step + 2) * 7),
    ];
  });

  return { indent, tokens };
}

/** The change: one line removed, three added, the caret at the end of the last. */
const HUNK_LINES: readonly Line[] = [
  {
    indent: 2,
    diff: "removed",
    tokens: [
      ["punct", 1],
      ["name", 5],
      ["name", 4],
      ["punct", 2],
      ["name", 4],
      ["punct", 2],
      ["name", 6],
      ["punct", 2],
      ["name", 9],
      ["punct", 3],
    ],
  },
  {
    indent: 2,
    diff: "added",
    tokens: [
      ["punct", 1],
      ["name", 5],
      ["name", 5],
      ["punct", 2],
      ["name", 8],
      ["punct", 1],
      ["name", 3],
      ["punct", 2],
      ["name", 6],
      ["punct", 3],
    ],
  },
  {
    indent: 3,
    diff: "added",
    tokens: [
      ["punct", 1],
      ["name", 5],
      ["name", 1],
      ["punct", 2],
      ["name", 8],
      ["punct", 3],
    ],
  },
  {
    indent: 3,
    diff: "added",
    tokens: [
      ["punct", 1],
      ["name", 4],
      ["name", 5],
      ["punct", 2],
      ["name", 8],
      ["punct", 1],
      ["name", 3],
      ["punct", 3],
    ],
  },
];

/** Indents of the lines either side of the change; null is a blank line. */
const ABOVE = [0, 1, 1, 2, 3, 3, 2, 1, null, 1] as const;

const BELOW = [1, 0, null, 0, 1, 1, 2, 2] as const;

/** The file as a minimap, a line a row: what led up to the change, the change, what follows. */
const CODE: readonly Line[] = [
  ...ABOVE.map((indent, index) => sketch(indent, index)),
  ...HUNK_LINES,
  {
    indent: 2,
    tokens: [
      ["punct", 2],
      ["name", 5],
      ["punct", 1],
    ],
  },
  ...BELOW.map((indent, index) => sketch(indent, index + 20)),
];

/** Where the code starts, how far one indent steps, and which lines the change covers. */
const SOURCE = {
  column: 44,
  indent: 3,
  firstRow: 1,
  hunk: { from: ABOVE.length, to: ABOVE.length + HUNK_LINES.length - 1 },
} as const;

/** Each token's first column and width: one blank column between tokens. */
function placed(
  line: Line,
): readonly { readonly kind: Token; readonly column: number; readonly width: number }[] {
  const starts = line.tokens.map((_, index) =>
    line.tokens.slice(0, index).reduce((left, token) => left + token[1] + 1, 0),
  );

  return line.tokens.map((token, index) => ({
    kind: token[0],
    column: SOURCE.column + line.indent * SOURCE.indent + (starts[index] ?? 0),
    width: token[1],
  }));
}

/** Lines dim with their distance from the change; the removed line is a ghost. */
function lineFocus(index: number): number {
  const away = Math.max(0, SOURCE.hunk.from - index, index - SOURCE.hunk.to);

  return Math.max(0.3, 1 - 0.075 * away);
}

const CODE_CELLS = new Map(
  CODE.flatMap((line, index) =>
    placed(line).flatMap((token) =>
      Array.from(
        { length: token.width },
        (_, step) =>
          [
            `${String(token.column + step)},${String(SOURCE.firstRow + index)}`,
            line.diff === "removed" ? 0.2 : TOKEN_STRENGTH[token.kind] * lineFocus(index),
          ] as const,
      ),
    ),
  ),
);

const CODE_FIELD = plot(
  (_x, _y, column, row) => CODE_CELLS.get(`${String(column)},${String(row)}`) ?? 0,
  () => 0.08,
);

/** The change's frame runs in the gaps between rows, around exactly its lines. */
const HUNK = {
  x: SOURCE.column * CELL - CELL,
  y: (SOURCE.firstRow + SOURCE.hunk.from) * CELL,
  w: 480,
  h: HUNK_LINES.length * CELL,
} as const;

const CARET = (() => {
  const last = placed(HUNK_LINES.at(-1) ?? { indent: 0, tokens: [] }).at(-1);

  return {
    x: ((last?.column ?? SOURCE.column) + (last?.width ?? 0)) * CELL + 2,
    y: (SOURCE.firstRow + SOURCE.hunk.to) * CELL + CELL / 2,
  };
})();

export function EditorStrip(): ReactElement {
  return (
    <Strip prism={spectrum(105)} backdrop={<Field plot={CODE_FIELD} twinkle />}>
      <rect
        x={CARET.x}
        y={CARET.y - 6}
        width={1.6}
        height={12}
        {...props(ink.primaryFill, styles.blink)}
      />
      <Label x={CARET.x + 14} y={CARET.y}>
        You · uncommitted
      </Label>
      <Frame x={HUNK.x} y={HUNK.y} w={HUNK.w} h={HUNK.h} />
      <Chip x={HUNK.x} y={HUNK.y + 9} label="+3 −1" />
    </Strip>
  );
}

/** What leads a line: the prompt sign, or a pass mark indented as a test runner prints it. */
const LEADS = { prompt: { mark: 0, text: 2 }, pass: { mark: 2, text: 4 } } as const;

interface Entry {
  readonly lead?: keyof typeof LEADS;
  readonly tokens: readonly number[];
  /** A progress bar after the tokens: cells filled, of cells in all. */
  readonly bar?: readonly [number, number];
}

/** A session, oldest first: commands after a prompt, their output flush left. */
const SESSION: readonly Entry[] = [
  { lead: "prompt", tokens: [4, 5, 12, 4] },
  { lead: "pass", tokens: [18, 10] },
  { tokens: [5, 9, 4] },
  { tokens: [] },
  { lead: "prompt", tokens: [3, 4] },
  { tokens: [7, 8], bar: [20, 24] },
  { tokens: [4, 2, 11] },
  { tokens: [] },
  { lead: "prompt", tokens: [4, 5, 8] },
  { tokens: [7, 2, 23] },
  { lead: "prompt", tokens: [] },
];

const SHELL = { column: 50, firstRow: 1, viewport: 3 } as const;

/** Lines above the viewport are scrollback and fade toward the top; inside, the newest is brightest. */
function entryFade(index: number): number {
  if (index < SHELL.viewport) return 0.15 + 0.1 * index;

  return 0.55 + (0.45 * (index - SHELL.viewport)) / (SESSION.length - 1 - SHELL.viewport);
}

/** Each lit cell of a line as [column, strength]: its lead mark, its words, its bar. */
function entryCells(entry: Entry): readonly (readonly [number, number])[] {
  const lead = entry.lead === undefined ? undefined : LEADS[entry.lead];
  const start = SHELL.column + (lead?.text ?? 0);

  const starts = entry.tokens.map((_, index) =>
    entry.tokens.slice(0, index).reduce((left, width) => left + width + 1, start),
  );

  const words = entry.tokens.flatMap((width, index) =>
    Array.from(
      { length: width },
      (_, step) => [(starts[index] ?? start) + step, entry.lead === "prompt" ? 0.95 : 0.6] as const,
    ),
  );

  const end = (starts.at(-1) ?? start) + (entry.tokens.at(-1) ?? 0) + 1;
  const bar = entry.bar ?? [0, 0];

  const progress = Array.from(
    { length: bar[1] },
    (_, step) => [end + step, step < bar[0] ? 0.95 : 0.2] as const,
  );

  const marks = lead === undefined ? [] : [[SHELL.column + lead.mark, 0.75] as const];

  return [...marks, ...words, ...progress];
}

const SESSION_CELLS = new Map(
  SESSION.flatMap((entry, index) =>
    entryCells(entry).map(
      (cell) =>
        [
          `${String(cell[0])},${String(SHELL.firstRow + index * 2)}`,
          cell[1] * entryFade(index),
        ] as const,
    ),
  ),
);

const SESSION_FIELD = plot(
  (_x, _y, column, row) => SESSION_CELLS.get(`${String(column)},${String(row)}`) ?? 0,
  () => 0.1,
);

const VIEWPORT = {
  x: SHELL.column * CELL - CELL,
  y: (SHELL.firstRow + SHELL.viewport * 2) * CELL - 4,
  w: 416,
  h: 132,
} as const;

const CURSOR = {
  x: (SHELL.column + 2) * CELL + 1,
  y: (SHELL.firstRow + (SESSION.length - 1) * 2) * CELL + 1,
} as const;

export function TerminalStrip(): ReactElement {
  return (
    <Strip prism={spectrum(150)} backdrop={<Field plot={SESSION_FIELD} cells="square" />}>
      <rect
        x={CURSOR.x}
        y={CURSOR.y}
        width={6}
        height={6}
        {...props(ink.primaryFill, styles.blink)}
      />
      <Label x={VIEWPORT.x + VIEWPORT.w} y={VIEWPORT.y - 16} align="end">
        10,000 lines
      </Label>
      <Frame x={VIEWPORT.x} y={VIEWPORT.y} w={VIEWPORT.w} h={VIEWPORT.h} />
      <Chip x={VIEWPORT.x} y={VIEWPORT.y + 9} label="zsh" icon="console" />
    </Strip>
  );
}

const GLOBE = { x: 604, y: BOARD.cy, r: 56 } as const;

/** The built-in browser around the globe: trackers stop at its sides, other requests pass through. */
const BROWSER = { x: GLOBE.x - 100, y: GLOBE.y - 80, w: 200, h: 160 } as const;

/** How far from the globe's centre a request heading in along `u` meets the browser's edge. */
function edgeReach(u: { readonly x: number; readonly y: number }): number {
  return Math.min(BROWSER.w / 2 / Math.abs(u.x), BROWSER.h / 2 / Math.abs(u.y));
}

const MERIDIAN = Math.PI / 6;

/** Rows a line of latitude runs along: the equator and two either side, on cell centres. */
const PARALLELS = new Set([6, 8, 12, 16, 18]);

const DAYLIGHT = (() => {
  const length = Math.hypot(0.6, 0.55, 0.58);

  return { x: -0.6 / length, y: -0.55 / length, z: 0.58 / length };
})();

/** A wire globe turned `turn` radians: meridians that move, parallels that stay, a lit side and a rim. */
function globe(x: number, y: number, row: number, turn: number): number {
  const dx = (x - GLOBE.x) / GLOBE.r;
  const dy = (y - GLOBE.y) / GLOBE.r;
  const reach = Math.hypot(dx, dy);
  const rim = 0.6 * Math.exp(-((reach - 1) ** 2) / 0.005);

  if (reach >= 1) return rim;
  const depth = Math.sqrt(1 - reach * reach);
  const light = Math.max(0, dx * DAYLIGHT.x + dy * DAYLIGHT.y + depth * DAYLIGHT.z);
  const sweep = (((Math.atan2(dx, depth) + turn) / MERIDIAN) % 1) + 1;
  const meridian = Math.abs((sweep % 1) - 0.5) > 0.36;
  const line = meridian || PARALLELS.has(row) ? 0.95 : 0.12;

  return Math.max(rim, line * (0.35 + 0.65 * light));
}

/** One turn between meridians, in eight steps, so the loop closes. */
const TURNS = Array.from({ length: FRAME_COUNT }, (_, frame) =>
  plot(
    (x, y, _column, row) => globe(x, y, row, (frame * MERIDIAN) / FRAME_COUNT),
    () => 0.12,
  ),
);

const REQUESTS = [
  { degrees: 158, blocked: false },
  { degrees: 172, blocked: true },
  { degrees: 183, blocked: false },
  { degrees: 194, blocked: true },
  { degrees: 205, blocked: true },
  { degrees: -24, blocked: true },
  { degrees: -14, blocked: true },
  { degrees: -3, blocked: false },
  { degrees: 8, blocked: true },
  { degrees: 22, blocked: true },
].map((request) => {
  const angle = (request.degrees * Math.PI) / 180;
  const u = { x: Math.cos(angle), y: -Math.sin(angle) };

  return {
    ...request,
    u,
    edge: edgeReach(u),
    head: request.blocked ? edgeReach(u) + 4 : GLOBE.r + 2,
    tail: request.blocked ? 230 : 214,
  };
});

/** Requests streak in toward the globe; trackers stop at the browser's edge, the rest reach the rim. */
const TRAFFIC = plot(
  (x, y) =>
    Math.max(
      0,
      ...REQUESTS.map((request) => {
        const along = (x - GLOBE.x) * request.u.x + (y - GLOBE.y) * request.u.y;
        const across = Math.abs((x - GLOBE.x) * request.u.y - (y - GLOBE.y) * request.u.x);

        if (along < request.head - 6 || along > request.tail) return 0;
        const tail = 1 - Math.max(0, along - request.head) / (request.tail - request.head);
        const gain = request.blocked ? 1.1 : 0.8;

        return gain * tail ** 1.2 * Math.exp(-(across ** 2) / 22);
      }),
    ),
  () => 0.3,
);

const IMPACTS = REQUESTS.flatMap((request) =>
  request.blocked
    ? [{ x: GLOBE.x + request.edge * request.u.x, y: GLOBE.y + request.edge * request.u.y }]
    : [],
);

export function BrowserStrip(): ReactElement {
  return (
    <Strip
      prism={spectrum(220)}
      backdrop={
        <g>
          <Field plot={TRAFFIC} twinkle />
          <Frames plots={TURNS} seconds={2.4} />
        </g>
      }
    >
      <Frame x={BROWSER.x} y={BROWSER.y} w={BROWSER.w} h={BROWSER.h} />
      {IMPACTS.map((impact) => (
        <circle
          key={`${impact.x},${impact.y}`}
          cx={impact.x}
          cy={impact.y}
          r={2.2}
          {...props(ink.markFill)}
        />
      ))}
      <Chip x={BROWSER.x} y={BROWSER.y + 9} label="14 blocked" icon="shield" />
    </Strip>
  );
}

/** One agent turn, parents before children, in milliseconds. Critical spans gate the turn's end. */
const SPANS = [
  { name: "agent.turn", from: 0, to: 250, critical: true },
  { name: "model.stream", from: 4, to: 72, critical: true },
  { name: "tool.read", from: 76, to: 104, critical: false },
  { name: "fs.stat", from: 80, to: 100, critical: false },
  { name: "tool.bash", from: 108, to: 172, critical: true },
  { name: "pnpm test", from: 112, to: 148, critical: true },
  { name: "git diff", from: 152, to: 168, critical: false },
  { name: "reply", from: 176, to: 250, critical: false },
] as const;

/** Two pixels a millisecond from x 344; spans stack a row apart under the ruler. */
const TRACE = { origin: 344, scale: 2, ruler: 24, firstRow: 4 } as const;

function msX(ms: number): number {
  return TRACE.origin + ms * TRACE.scale;
}

/** The turn as a waterfall, a span a row: the critical path burns, the rest glows. */
const WATERFALL = plot(
  (x, _y, column, row) => {
    const index = (row - TRACE.firstRow) / 2;
    const span = SPANS[index];

    if (span === undefined || x < msX(span.from) || x > msX(span.to)) return 0;
    const cap = x < msX(span.from) + CELL || x > msX(span.to) - CELL ? 0.75 : 1;

    return (span.critical ? 0.95 : 0.6) * cap * (0.9 + 0.1 * Math.sin(column * 1.7));
  },
  () => 0.12,
);

/** The frame reads one tool call: a slice of time down every row, like the hue picker's band. */
const FOCUS = SPANS[4];

const WINDOW = {
  x: msX(FOCUS.from),
  y: 44,
  w: (FOCUS.to - FOCUS.from) * TRACE.scale,
  h: 116,
} as const;

const TIME_TICKS = Array.from({ length: 26 }, (_, index) => {
  const x = msX(index * 10);

  return `M${x} ${TRACE.ruler}V${TRACE.ruler - (index % 5 === 0 ? 6 : 3)}`;
}).join("");

export function AdvancedStrip(): ReactElement {
  return (
    <Strip
      prism={spectrum(15)}
      backdrop={
        <g>
          <Field plot={WATERFALL} twinkle />
          <path d={`M${msX(0)} ${TRACE.ruler}H${msX(250)}`} {...props(ink.strong)} />
          <path d={TIME_TICKS} {...props(ink.faint, styles.butt)} />
        </g>
      }
    >
      {[0, 50, 100, 150, 200, 250].map((ms) => (
        <Label key={ms} x={msX(ms)} y={TRACE.ruler - 14} align="middle">
          {ms === 250 ? "250 ms" : String(ms)}
        </Label>
      ))}
      <Label x={msX(0) - 8} y={TRACE.firstRow * CELL + CELL / 2} align="end" mono>
        agent.turn
      </Label>
      <Label x={msX(SPANS[1].to) + 8} y={(TRACE.firstRow + 2) * CELL + CELL / 2} mono>
        model.stream
      </Label>
      <g {...props(styles.sweep)}>
        <Level from={{ x: msX(0), y: TRACE.ruler }} to={{ x: msX(0), y: 164 }} tone="faint" />
      </g>
      <Frame x={WINDOW.x} y={WINDOW.y} w={WINDOW.w} h={WINDOW.h} />
      <Chip x={WINDOW.x} y={WINDOW.y + 9} label={FOCUS.name} />
      <Label x={WINDOW.x + WINDOW.w / 2} y={WINDOW.y + WINDOW.h + 13} align="middle">
        {`${String(FOCUS.to - FOCUS.from)} ms`}
      </Label>
    </Strip>
  );
}

const blink = keyframes({ "0%, 49%": { opacity: 1 }, "50%, 100%": { opacity: 0 } });

const sweep = keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(500px)" },
});

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  butt: { strokeLinecap: "butt" },
  blink: {
    animationName: { default: blink, [reduced]: "none" },
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
  },
  sweep: {
    animationName: { default: sweep, [reduced]: "none" },
    animationDuration: "6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
});
