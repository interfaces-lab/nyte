import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const CATEGORIES = [
  "native diff+write",
  "native layout+paint (Yoga)",
  "JS paint & measure hooks",
  "frame other",
  "model (reduce, derive)",
  "Solid re-render",
  "input & keymap",
  "host link",
  "GC",
  "other",
] as const;

type Category = (typeof CATEGORIES)[number];

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly children?: readonly number[];
}

interface Profile {
  readonly nodes: readonly ProfileNode[];
  readonly startTime: number;
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

const FRAME_BOUNDARIES: readonly (readonly [Category, RegExp])[] = [
  [
    "native diff+write",
    /^(commit|commitSplit|presentNativeScene|render|renderSplit|whenPresented)$/u,
  ],
  ["native layout+paint (Yoga)", /^(sceneFrameStep\w*|ot_scene_frame_step\w*)$/u],
  [
    "JS paint & measure hooks",
    /^(recordPaint|_recordNativeScenePaint|_runNativeSceneHook|runLifecyclePasses|_runLifecyclePass|flushStaged)$/u,
  ],
];

const dir = process.argv[2];

if (dir === undefined) throw new Error("Usage: attribute.ts <run dir>");

process.stdout.write(`| profile | ${CATEGORIES.join(" | ")} | window ms | sampled ms |\n`);
process.stdout.write(`| --- |${CATEGORIES.map(() => " ---: |").join("")} ---: | ---: |\n`);

for (const file of readdirSync(dir)
  .filter((name) => name.endsWith(".cpuprofile"))
  .toSorted()) {
  const result = parseJson(
    readFileSync(join(dir, file.replace(/\.cpuprofile$/u, ".json")), "utf8"),
  );
  const window = readWindow(result);
  const split = attribute(parseProfile(readFileSync(join(dir, file), "utf8")), window);
  const total = [...split.values()].reduce((sum, value) => sum + value, 0);

  process.stdout.write(
    `| ${file.replace(/-1\.cpuprofile$/u, "")} | ${CATEGORIES.map((category) => percent(split.get(category) ?? 0, total)).join(" | ")} | ${(window.end - window.start).toFixed(0)} | ${total.toFixed(0)} |\n`,
  );
}

function attribute(
  profile: Profile,
  window: { readonly start: number; readonly end: number },
): Map<Category, number> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map(
    profile.nodes.flatMap((node) =>
      (node.children ?? []).map((child) => [child, node.id] as const),
    ),
  );
  const split = new Map<Category, number>();
  const cache = new Map<number, Category | null>();
  const interval =
    profile.timeDeltas.toSorted((a, b) => a - b)[Math.floor(profile.timeDeltas.length / 2)] ?? 0;
  let at = profile.startTime;

  for (const [index, sample] of profile.samples.entries()) {
    const delta = profile.timeDeltas[index] ?? 0;
    at += delta;

    if (at < window.start * 1000 || at > window.end * 1000) continue;
    const category = cache.get(sample) ?? classify(stack(sample, nodes, parents));

    cache.set(sample, category);

    if (category === null) continue;
    split.set(category, (split.get(category) ?? 0) + Math.min(delta, interval) / 1000);
  }

  return split;
}

function stack(
  leaf: number,
  nodes: ReadonlyMap<number, ProfileNode>,
  parents: ReadonlyMap<number, number>,
): CallFrame[] {
  const frames: CallFrame[] = [];

  for (let id: number | undefined = leaf; id !== undefined; id = parents.get(id)) {
    const node = nodes.get(id);

    if (node !== undefined) frames.push(node.callFrame);
  }

  return frames;
}

function classify(frames: readonly CallFrame[]): Category | null {
  const leaf = frames[0]?.functionName ?? "";

  if (leaf === "(idle)" || leaf === "(program)") return null;

  if (leaf === "(garbage collector)" || leaf === "gc") return "GC";

  if (frames.some((frame) => frame.functionName === "loop" && frame.url.endsWith("renderer.ts"))) {
    for (const frame of frames) {
      const boundary = FRAME_BOUNDARIES.find(([, pattern]) => pattern.test(frame.functionName));

      if (boundary !== undefined) return boundary[0];
    }

    return "frame other";
  }

  if (frames.some((frame) => /\/tui\/src\/model\//u.test(frame.url))) {
    return "model (reduce, derive)";
  }

  if (frames.some((frame) => /solid-js|@opentui\/solid|\/tui\/src\/ui\//u.test(frame.url))) {
    return "Solid re-render";
  }

  if (frames.some((frame) => /@opentui\/keymap|KeyHandler|stdin-parser/u.test(frame.url))) {
    return "input & keymap";
  }

  if (
    frames.some((frame) =>
      /@nyte-ai\/|\/packages\/(sdk|protocol|schema|core|host)\/|live-host|host-port/u.test(
        frame.url,
      ),
    )
  ) {
    return "host link";
  }

  return "other";
}

function percent(part: number, total: number): string {
  return total === 0 ? "0%" : `${((part / total) * 100).toFixed(0)}%`;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function readWindow(result: unknown): { readonly start: number; readonly end: number } {
  if (typeof result !== "object" || result === null || !("window" in result)) {
    throw new Error("The result has no window.");
  }
  const window = result.window;

  if (typeof window !== "object" || window === null || !("start" in window) || !("end" in window)) {
    throw new Error("The result's window is malformed.");
  }

  return { start: Number(window.start), end: Number(window.end) };
}

function parseProfile(text: string): Profile {
  const parsed: unknown = JSON.parse(text);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("nodes" in parsed) ||
    !("samples" in parsed) ||
    !("timeDeltas" in parsed) ||
    !("startTime" in parsed) ||
    !Array.isArray(parsed.nodes) ||
    !Array.isArray(parsed.samples) ||
    !Array.isArray(parsed.timeDeltas)
  ) {
    throw new Error("Not a CPU profile.");
  }

  return {
    nodes: parsed.nodes.filter(
      (node: unknown): node is ProfileNode =>
        typeof node === "object" &&
        node !== null &&
        "id" in node &&
        "callFrame" in node &&
        typeof node.callFrame === "object" &&
        node.callFrame !== null &&
        "functionName" in node.callFrame &&
        "url" in node.callFrame,
    ),
    samples: parsed.samples.map(Number),
    timeDeltas: parsed.timeDeltas.map(Number),
    startTime: Number(parsed.startTime),
  };
}
