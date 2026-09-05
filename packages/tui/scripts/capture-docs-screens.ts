/**
 * Capture production TUI frames as PNGs for `packages/docs`.
 *
 * Boots the QA driver (OpenTUI test renderer, sandbox world), then rasterizes
 * `captureSpans()` with Berkeley Mono via ImageMagick. Regenerates
 * `packages/docs/public/tui/*.png`.
 *
 *   pnpm --dir packages/tui docs:screens
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { rgbToHex } from "@opentui/core";
import type { CapturedFrame, RGBA } from "@opentui/core";
import { COMPOSER_PLACEHOLDER } from "../src/constants.ts";
import { boot } from "../test/qa/driver.ts";
import type { Qa } from "../test/qa/driver.ts";

const OUT_DIR = join(import.meta.dirname, "../../docs/public/tui");
const FONT = join(import.meta.dirname, "../../docs/src/fonts/BerkeleyMono-Regular.ttf");
const FONT_BOLD = join(import.meta.dirname, "../../docs/src/fonts/BerkeleyMono-Bold.ttf");
const TERMINAL = "#0a0a0a";
const CELL_W = 10;
const CELL_H = 20;
const FONT_SIZE = 15;
const PAD = 12;

function mvgQuote(text: string): string {
  return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", " ").replaceAll("\r", "")}'`;
}

function fillOf(color: RGBA): string {
  const alpha = color.toInts()[3];
  if (alpha === 0) return TERMINAL;
  return rgbToHex(color);
}

function frameToMvg(frame: CapturedFrame): string {
  const width = frame.cols * CELL_W + PAD * 2;
  const height = frame.rows * CELL_H + PAD * 2;
  const lines = [
    `viewbox 0 0 ${String(width)} ${String(height)}`,
    "push graphic-context",
    `fill '${TERMINAL}'`,
    `rectangle 0,0 ${String(width)},${String(height)}`,
    `font ${mvgQuote(FONT)}`,
    `font-size ${String(FONT_SIZE)}`,
  ];

  for (let y = 0; y < frame.lines.length; y++) {
    let x = 0;
    for (const span of frame.lines[y]?.spans ?? []) {
      const x0 = PAD + x * CELL_W;
      const y0 = PAD + y * CELL_H;
      lines.push(`fill '${fillOf(span.bg)}'`);
      lines.push(
        `rectangle ${String(x0)},${String(y0)} ${String(x0 + span.width * CELL_W)},${String(y0 + CELL_H)}`,
      );
      x += span.width;
    }
  }

  for (let y = 0; y < frame.lines.length; y++) {
    let x = 0;
    for (const span of frame.lines[y]?.spans ?? []) {
      if (span.text !== "") {
        const x0 = PAD + x * CELL_W;
        const baseline = PAD + y * CELL_H + 15;
        const bold = (span.attributes & 1) !== 0;
        if (bold) lines.push(`font ${mvgQuote(FONT_BOLD)}`);
        lines.push(`fill '${fillOf(span.fg)}'`);
        lines.push(`text ${String(x0)},${String(baseline)} ${mvgQuote(span.text)}`);
        if (bold) lines.push(`font ${mvgQuote(FONT)}`);
      }
      x += span.width;
    }
  }

  lines.push("pop graphic-context");
  return `${lines.join("\n")}\n`;
}

async function writePng(frame: CapturedFrame, outPath: string, scratch: string): Promise<void> {
  const mvgPath = join(scratch, `${outPath.split("/").at(-1) ?? "frame"}.mvg`);
  await writeFile(mvgPath, frameToMvg(frame));
  const result = spawnSync(
    "magick",
    [`mvg:${mvgPath}`, "-filter", "Lanczos", "-resize", "200%", "-strip", `PNG32:${outPath}`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `magick exited ${String(result.status)}`);
  }
}

async function shot(qa: Qa, name: string, scratch: string): Promise<void> {
  await qa.until(() => true);
  const path = join(OUT_DIR, `${name}.png`);
  await writePng(qa.spans(), path, scratch);
  process.stderr.write(`wrote ${path}\n`);
}

async function runSlash(qa: Qa, invocation: string, expected: string): Promise<void> {
  await qa.clear();
  await qa.type(`/${invocation}`);
  await qa.until((frame) => frame.includes(`❯ /${invocation}`));
  await qa.key("RETURN");
  await qa.until((frame) => frame.includes(expected));
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("docs screenshots rasterize Berkeley Mono via ImageMagick on macOS");
  }
  await mkdir(OUT_DIR, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "uji-tui-screens-"));
  const qa = await boot({ width: 96, height: 18 });
  try {
    await qa.until((frame) => frame.includes(COMPOSER_PLACEHOLDER));
    await qa.submit("think about the health probe");
    await qa.idle();
    await qa.until(
      (frame) =>
        frame.includes("Worked") &&
        (frame.includes("Weighing two readings") || frame.includes("Here is the answer")),
    );
    await shot(qa, "chat", scratch);

    await qa.clear();
    await qa.type("/");
    await qa.until((frame) => frame.includes("Browse commands"));
    await shot(qa, "commands", scratch);
    await qa.escape();

    await runSlash(qa, "settings", "Settings  │");
    await shot(qa, "settings", scratch);
    await qa.escape();

    await runSlash(qa, "tree", "Session tree");
    await shot(qa, "tree", scratch);
  } finally {
    await qa.close();
  }
}

await main();
