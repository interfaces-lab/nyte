import { chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { Type } from "typebox";
import { Value } from "typebox/value";

/** One screencast frame of a Playwright trace, stamped in epoch milliseconds. */
interface Frame {
  readonly epochMs: number;
  readonly jpeg: Buffer;
}

const ScreencastFrameSchema = Type.Object({
  type: Type.Literal("screencast-frame"),
  file: Type.Optional(Type.String()),
  sha1: Type.Optional(Type.String()),
  timestamp: Type.Number(),
  frameSwapWallTime: Type.Optional(Type.Number()),
});

const ContextOptionsSchema = Type.Object({
  type: Type.Literal("context-options"),
  wallTime: Type.Number(),
  monotonicTime: Type.Number(),
});

/**
 * The files of a zip archive by name. Playwright writes trace.zip with stored or deflated
 * entries and a plain central directory, which is all this reads.
 */
function unzip(archive: Buffer): ReadonlyMap<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  if (end < 0) throw new Error("The trace is not a zip archive.");
  const count = archive.readUInt16LE(end + 10);
  const files = new Map<string, Buffer>();
  let entry = archive.readUInt32LE(end + 16);

  for (let index = 0; index < count; index++) {
    const method = archive.readUInt16LE(entry + 10);
    const compressed = archive.readUInt32LE(entry + 20);
    const nameLength = archive.readUInt16LE(entry + 28);
    const extraLength = archive.readUInt16LE(entry + 30);
    const commentLength = archive.readUInt16LE(entry + 32);
    const local = archive.readUInt32LE(entry + 42);
    const name = archive.toString("utf8", entry + 46, entry + 46 + nameLength);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + compressed);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    entry += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/** Every screencast frame a trace recorded, in order, with its wall-clock time. */
async function readFrames(trace: string): Promise<readonly Frame[]> {
  const files = unzip(await readFile(trace));

  const events = [...files]
    .filter(([name]) => name.endsWith(".trace"))
    .flatMap(([, data]) => data.toString("utf8").split("\n"))
    .flatMap((line): unknown[] => (line.trim() === "" ? [] : [JSON.parse(line)]));

  const clock = events.find((event) => Value.Check(ContextOptionsSchema, event));

  const offset = Value.Check(ContextOptionsSchema, clock)
    ? clock.wallTime - clock.monotonicTime
    : null;

  return events.flatMap((event) => {
    if (!Value.Check(ScreencastFrameSchema, event)) return [];
    const jpeg = files.get(event.file ?? `resources/${event.sha1 ?? ""}`);

    const epochMs =
      event.frameSwapWallTime ?? (offset === null ? undefined : offset + event.timestamp);

    return jpeg === undefined || epochMs === undefined ? [] : [{ epochMs, jpeg }];
  });
}

/**
 * Lays out up to `limit` of `frames`, evenly spaced, as one PNG strip labelled with each frame's
 * milliseconds since `originEpochMs` (the process spawn), and returns how many it drew. Renders
 * in the Chromium Playwright installs; a missing browser fails with Playwright's install hint.
 */
async function writeStrip(
  frames: readonly Frame[],
  originEpochMs: number,
  title: string,
  output: string,
  limit = 12,
): Promise<number> {
  const step = Math.max(1, (frames.length - 1) / Math.max(1, limit - 1));

  const picked = [
    ...new Set(
      Array.from({ length: Math.min(limit, frames.length) }, (_, index) =>
        Math.round(index * step),
      ),
    ),
  ].flatMap((index) => frames[index] ?? []);

  const cells = picked
    .map(
      (frame) =>
        `<figure><img src="data:image/jpeg;base64,${frame.jpeg.toString("base64")}"><figcaption>+${(frame.epochMs - originEpochMs).toFixed(0)} ms</figcaption></figure>`,
    )
    .join("");

  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1_600, height: 400 } });
    await page.setContent(
      `<style>body{margin:12px;font:13px system-ui;background:#fff}h1{font-size:14px;margin:0 0 8px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}figure{margin:0}img{width:100%;border:1px solid #ccc}figcaption{text-align:center}</style><h1>${title}</h1><main>${cells}</main>`,
    );
    await page.screenshot({ path: output, fullPage: true });
  } finally {
    await browser.close();
  }

  return picked.length;
}

/**
 * Stops `context`'s tracing into `<prefix>.trace.zip` and draws `<prefix>-strip.png` from its
 * frames up to two frames after `untilEpochMs` (the first typed character's paint): the startup,
 * or for a restored chat the resume, as the user saw it.
 */
export async function saveFilmstrip(
  context: BrowserContext,
  prefix: string,
  title: string,
  spawnEpochMs: number,
  untilEpochMs: number,
): Promise<string> {
  await context.tracing.stop({ path: `${prefix}.trace.zip` });

  const frames = (await readFrames(`${prefix}.trace.zip`)).filter(
    (frame) => frame.epochMs <= untilEpochMs + 34,
  );

  const drawn = await writeStrip(frames, spawnEpochMs, title, `${prefix}-strip.png`);

  return `${prefix}.trace.zip, ${prefix}-strip.png (${drawn} of ${frames.length} frames)`;
}
