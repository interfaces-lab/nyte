import { mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WriteStream } from "node:tty";
import { afterAll, expect, test } from "bun:test";
import type { RGBA } from "@opentui/core";
import { themeForMode } from "../../src/lib/theme.ts";
import { startTui } from "../harness/tui.ts";
import { hex, SAMPLE_ANSWER, saveFrame, saveProof } from "./scenario.ts";

/** What each terminal advertises; OpenTUI picks its color encoding from these. */
const DEPTHS = {
  truecolor: { TERM: "xterm-256color", COLORTERM: "truecolor" },
  ansi256: { TERM: "xterm-256color", COLORTERM: "" },
  ansi16: { TERM: "xterm", COLORTERM: "" },
} as const;

type Depth = keyof typeof DEPTHS;

type Rgb = readonly [number, number, number];

/** The 16 system colors as OpenTUI's encoder assumes them when it picks a 256-color index. */
const OPENTUI_SYSTEM: readonly Rgb[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

/** xterm's default 16-color palette, which a 16-color terminal maps 24-bit colors onto. */
const XTERM_16: readonly Rgb[] = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

const CUBE = [0, 95, 135, 175, 215, 255] as const;

function paletteColor(index: number): Rgb {
  if (index < 16) return OPENTUI_SYSTEM[index] ?? [0, 0, 0];

  if (index >= 232) {
    const level = 8 + 10 * (index - 232);

    return [level, level, level];
  }

  const cube = index - 16;

  return [
    CUBE[Math.floor(cube / 36)] ?? 0,
    CUBE[Math.floor(cube / 6) % 6] ?? 0,
    CUBE[cube % 6] ?? 0,
  ];
}

const PALETTE_256: readonly Rgb[] = Array.from({ length: 256 }, (_, index) => paletteColor(index));

function distance(left: Rgb, right: Rgb): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;
}

function nearest(palette: readonly Rgb[], color: Rgb): number {
  return palette.reduce(
    (best, entry, index) =>
      distance(entry, color) < distance(palette[best] ?? entry, color) ? index : best,
    0,
  );
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;

    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(left: Rgb, right: Rgb): number {
  const [light, dark] = [luminance(left), luminance(right)].toSorted((a, b) => b - a);

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function hexRgb(color: string): Rgb {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((at) =>
    Number.parseInt(color.slice(at, at + 2), 16),
  );

  return [red, green, blue];
}

/** `color` over `under` by its alpha, as the terminal cell ends up. */
function over(color: RGBA, under: Rgb): Rgb {
  const [red, green, blue, alpha] = color.toInts();
  const share = alpha / 255;

  return [
    Math.round(red * share + under[0] * (1 - share)),
    Math.round(green * share + under[1] * (1 - share)),
    Math.round(blue * share + under[2] * (1 - share)),
  ];
}

/** The color a terminal of `depth` shows for a 24-bit `color`. */
function shown(depth: Depth, color: Rgb): Rgb {
  if (depth === "ansi256") return PALETTE_256[nearest(PALETTE_256, color)] ?? color;

  if (depth === "ansi16") return XTERM_16[nearest(XTERM_16, color)] ?? color;

  return color;
}

/** Separator dots, box drawing, block elements and braille spinners are drawn shapes, not text to read; the theme keeps `muted` for them. */
const DECORATION = /^[\s\u00B7\u2500-\u259F\u2800-\u28FF]*$/u;

/** The least contrast a text cell may have: AA in 24-bit color, 3:1 once a palette has rounded it. */
const FLOOR: Readonly<Record<Depth, number>> = { truecolor: 4.5, ansi256: 3, ansi16: 3 };

/** A select-graphic-rendition sequence, its parameters captured. */
const SGR = new RegExp(`${String.fromCodePoint(27)}\\[([0-9;:]*)m`, "gu");

const OUTPUT = mkdtempSync(join(tmpdir(), "nyte-tui-terminal-"));

afterAll(() => rmSync(OUTPUT, { recursive: true, force: true }));

/** A terminal stdout of `columns` × `rows` whose bytes land in a file instead of a screen. */
class RecordingStdout extends WriteStream {
  readonly #path: string;

  constructor(path: string, columns: number, rows: number) {
    super(openSync(path, "w"));
    this.#path = path;
    this.columns = columns;
    this.rows = rows;
    this.isTTY = true;
  }

  text(): string {
    return readFileSync(this.#path, "latin1");
  }
}

for (const depth of ["truecolor", "ansi256", "ansi16"] as const)
  for (const mode of ["dark", "light"] as const)
    test(`${depth} ${mode}: every text cell of a conversation stays legible once the terminal shows it`, async () => {
      const output = new RecordingStdout(join(OUTPUT, `${depth}-${mode}.out`), 100, 32);

      await using tui = await startTui({
        renderer: {
          stdout: output,
          bufferedOutput: "stdout",
          forwardEnvKeys: [],
          environment: DEPTHS[depth],
        },
      });

      await tui.ready();
      await tui.send(`/theme ${mode}`);
      await tui.state((store) => store.state().facts.settings.theme === mode);
      tui.fixture.reply({ content: [{ type: "text", text: SAMPLE_ANSWER }] });
      await tui.send("show me the plan");
      await tui.frame((frame) => frame.includes("another step"));
      await tui.state((store) => store.screen().run.kind === "idle");
      await tui.renderOnce();
      await saveFrame(tui, `color-${depth}-${mode}`);

      const background = themeForMode(mode, {}).background;
      const backdrop = hexRgb(background);
      const cells: { text: string; fg: string; bg: string; ratio: number }[] = [];
      const onScreen = new Set<number>();

      for (const line of tui.captureSpans().lines)
        for (const span of line.spans) {
          const bg = over(span.bg, backdrop);
          const fg = over(span.fg, bg);

          onScreen.add(nearest(PALETTE_256, bg));

          if (DECORATION.test(span.text)) continue;
          onScreen.add(nearest(PALETTE_256, fg));
          const ratio = contrast(shown(depth, fg), shown(depth, bg));

          cells.push({
            text: span.text.trim(),
            fg: hex(span.fg),
            bg: hex(span.bg),
            ratio: Math.round(ratio * 100) / 100,
          });
        }

      const sgr = [...output.text().matchAll(SGR)].map((match) => match[1] ?? "");
      const direct = sgr.filter((codes) => /(?:^|;)[34]8;2;/u.test(codes)).length;
      const indexed = sgr.filter((codes) => /(?:^|;)[34]8;5;/u.test(codes)).length;

      const emitted = new Set(
        sgr.flatMap((codes) =>
          [...codes.matchAll(/[34]8;5;(\d+)/gu)].map((match) => Number(match[1])),
        ),
      );

      const failing = cells.filter((cell) => cell.ratio < FLOOR[depth]);

      await saveProof(`color-${depth}-${mode}-legibility`, {
        depth,
        mode,
        environment: DEPTHS[depth],
        sgr: { direct, indexed },
        floor: FLOOR[depth],
        least: cells.toSorted((a, b) => a.ratio - b.ratio).slice(0, 8),
        failing,
      });

      if (depth === "truecolor") {
        expect(direct).toBeGreaterThan(0);
        expect(indexed).toBe(0);
      }

      if (depth === "ansi256") {
        expect(direct).toBe(0);
        expect([...onScreen].filter((index) => !emitted.has(index))).toEqual([]);
      }

      if (depth === "ansi16") expect(direct).toBeGreaterThan(0);
      expect(failing).toEqual([]);
    });

const LINKED = "I picked **Luigi's**. [Open the menu](https://fixture.test/places/luigi).";

for (const [terminal, environment] of [
  ["kitty", { TERM: "xterm-kitty", COLORTERM: "truecolor" }],
  ["ghostty", { TERM: "xterm-ghostty", TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" }],
  ["xterm", { TERM: "xterm-256color", COLORTERM: "truecolor" }],
] as const)
  test(`${terminal}: a markdown link ${terminal === "xterm" ? "prints its target after its text where the terminal takes no hyperlinks" : "is an OSC 8 hyperlink to its target"}`, async () => {
    const output = new RecordingStdout(join(OUTPUT, `link-${terminal}.out`), 100, 32);

    await using tui = await startTui({
      renderer: { stdout: output, bufferedOutput: "stdout", forwardEnvKeys: [], environment },
    });

    await tui.ready();
    tui.fixture.reply({ content: [{ type: "text", text: LINKED }] });
    await tui.send("where should I eat");
    await tui.frame((frame) => frame.includes("Open the menu"));
    await tui.state((store) => store.screen().run.kind === "idle");
    await tui.renderOnce();
    await saveFrame(tui, `link-${terminal}`);

    const linked = output.text().includes("\x1b]8;id=");

    await saveProof(`link-${terminal}-output`, {
      environment,
      hyperlinks: tui.renderer.capabilities?.hyperlinks ?? null,
      osc8: linked,
      targetWritten: output.text().includes("https://fixture.test/places/luigi"),
      targetOnScreen: tui.captureCharFrame().includes("fixture.test"),
    });

    expect(linked).toBe(terminal !== "xterm");
    expect(
      tui.captureCharFrame().includes("Open the menu (https://fixture.test/places/luigi)"),
    ).toBe(terminal === "xterm");
  });

const PATHED = "The final file is `out/film.mp4`. The old one is at `/tmp/film/old.mp4`.";

for (const [terminal, environment] of [
  ["ghostty", { TERM: "xterm-ghostty", TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" }],
  ["xterm", { TERM: "xterm-256color", COLORTERM: "truecolor" }],
] as const)
  test(`${terminal}: a file path in inline code ${terminal === "xterm" ? "stays plain text where the terminal takes no hyperlinks" : "links to the file under the workspace, without the closing period"}`, async () => {
    const output = new RecordingStdout(join(OUTPUT, `file-link-${terminal}.out`), 100, 32);

    await using tui = await startTui({
      renderer: { stdout: output, bufferedOutput: "stdout", forwardEnvKeys: [], environment },
    });

    await tui.ready();
    tui.fixture.reply({ content: [{ type: "text", text: PATHED }] });
    await tui.send("where is the film");
    await tui.frame((frame) => frame.includes("tmp/film/old.mp4"));
    await tui.state((store) => store.screen().run.kind === "idle");
    await tui.renderOnce();
    await saveFrame(tui, `file-link-${terminal}`);

    const film = pathToFileURL(join(tui.store.state().facts.workspace.cwd, "out/film.mp4")).href;
    const old = pathToFileURL("/tmp/film/old.mp4").href;
    const written = output.text();

    await saveProof(`file-link-${terminal}-output`, {
      environment,
      hyperlinks: tui.renderer.capabilities?.hyperlinks ?? null,
      film: written.includes(`;${film}\x1b\\`),
      old: written.includes(`;${old}\x1b\\`),
    });

    expect(written.includes(`;${film}\x1b\\`)).toBe(terminal !== "xterm");
    expect(written.includes(`;${old}\x1b\\`)).toBe(terminal !== "xterm");
    expect(tui.captureCharFrame()).toContain(
      "The final file is out/film.mp4. The old one is at /tmp/film/old.mp4.",
    );
  });
