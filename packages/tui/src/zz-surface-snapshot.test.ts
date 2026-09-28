import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { MAIN, sessionId } from "@nyte-ai/core";
import type { SessionState } from "@nyte-ai/client";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { mountShell } from "./app/App.tsx";
import { deliveryChoices } from "./lanes.ts";
import { DARK_THEME, LIGHT_THEME } from "./theme.ts";
import { SPINNER_FRAMES } from "./constants.ts";

type Item = SessionState["transcript"]["items"][number];

const mounted: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of mounted.splice(0)) setup.renderer.destroy();
});

const paste = Array.from({ length: 12 }, (_, i) => `paste line ${String(i)}`).join("\n");
const userContent = [
  "Look at this please",
  paste,
  '<file src="file:///tmp/example.ts">\nconst a = 1;\nconst b = 2;\n</file>',
  '<shell command="ls -la" exit="1">\nfile-a\nfile-b\n</shell>',
  '<skill name="review" location="/tmp/skills/review/SKILL.md">\nbody\n</skill>',
].join("\n");

const items: Item[] = [
  { kind: "config", commit: "c1", at: 0, body: { kind: "config", model: { provider: "openai", id: "gpt-x" }, thinkingLevel: "high", agent: "build" } },
  {
    kind: "turn",
    id: "t1",
    run: { kind: "none" },
    parts: [
      { kind: "user", commit: "u1", parent: null, content: userContent, at: 0 },
      { kind: "thinking", commit: "th1", contentIndex: 0, text: "pondering **deeply**", at: 0 },
      { kind: "assistant", commit: "a1", contentIndex: 1, text: "# Answer\n\nSome `code` and a list:\n\n- one\n- two", at: 0 },
    ],
    startedAt: 1,
    durationMs: 3_000,
  },
  { kind: "config", commit: "c2", at: 2, body: { kind: "config", thinkingLevel: "low" } },
  { kind: "checkpoint", commit: "k1", at: 3, body: { kind: "checkpoint", summary: "## Summary\n\n- kept the plan\n- dropped the rest", retainedTail: [], tokensBefore: 12345 } },
  { kind: "summary", commit: "s1", at: 4, body: { kind: "summary", text: "branch went elsewhere" } },
  {
    kind: "turn",
    id: "t2",
    run: { kind: "none" },
    parts: [{ kind: "user", commit: "u2", parent: "s1", content: "second request", at: 5 }],
    failure: { class: "aborted", message: "Run stopped." },
    startedAt: 5,
    durationMs: 0,
  },
  {
    kind: "turn",
    id: "t3",
    run: { kind: "run", id: "live-run" },
    parts: [{ kind: "user", commit: "u3", parent: "u2", content: "third request", at: 6 }],
    startedAt: 6,
    durationMs: 0,
  },
];

function state(phase: "retry" | "respond"): SessionState {
  const id = sessionId("snapshot");
  return {
    sessionId: id,
    head: MAIN,
    seq: 1,
    info: { sessionId: id, activation: { kind: "active" }, createdAt: 0, lastActivityAt: 0, pinned: false, archived: false, heads: [{ head: MAIN, tip: "t3" }], config: {} },
    config: {},
    transcript: { items, tip: "t3" },
    pending: [],
    run: { runId: "live-run", head: MAIN, origin: { kind: "user" }, root: "live-run", phase: phase === "retry" ? { kind: "retry", attempt: 2, at: 0, failure: { class: "transient", message: "x" } } : { kind: "respond" }, startedAt: 6, attempts: 1, config: {} },
    compaction: undefined,
    overlay: phase === "respond" ? [{ kind: "thinking", runId: "live-run", attempt: 1, index: 0, text: "live thought" }] : [],
    settledToolCalls: new Set(),
    parked: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 128_000 },
    expectedTip: undefined,
  } as SessionState;
}

async function settled(setup: TestRendererSetup): Promise<string> {
  let previous = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    await setup.flush();
    await setup.waitForVisualIdle();
    await Bun.sleep(100);
    await setup.flush();
    const current = dump(setup);
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

function dump(setup: TestRendererSetup): string {
  const spinner = new Set<string>(SPINNER_FRAMES.join(""));
  return setup
    .captureSpans()
    .lines.map((line) =>
      line.spans
        .map((span) => `${[...span.text].map((c) => (spinner.has(c) ? "*" : c)).join("")}|${span.fg.toString()}|${span.bg.toString()}|${String(span.attributes)}`)
        .join(" ¦ "),
    )
    .join("\n")
    .replace(/Worked for \d+\.\d/g, "Worked for #.#");
}

test("surface snapshot", async () => {
  const out: string[] = [];
  for (const width of [90, 50]) {
    const setup = await createTestRenderer({ width, height: 160 });
    mounted.push(setup);
    const shell = await mountShell({ renderer: setup.renderer, initialTheme: DARK_THEME, roles: deliveryChoices, openPath: () => undefined });
    shell.view.sync(state("retry"));
    shell.view.syncShell({ kind: "shell", id: "sh1", command: "ls -la", startedAt: 5.5, output: "a\nb", state: "exited", exitCode: 2, finishedAt: 5.5 }, "not sent to model");
    shell.pendingTail.sync([{ kind: "pending", item: { change: "p1", delivery: "steer", at: 7, content: "pending steer with a\nsecond line" } } as never]);
    out.push(`== ${String(width)} retry dark`, await settled(setup));
    shell.view.sync(state("respond"));
    out.push(`== ${String(width)} respond dark`, await settled(setup));
    shell.setTheme({ ...LIGHT_THEME });
    out.push(`== ${String(width)} respond light`, await settled(setup));
  }
  writeFileSync(process.env.SNAP_OUT ?? "/tmp/nyte-tui-snap.txt", out.join("\n"));
  expect(out.length).toBeGreaterThan(0);
}, 60_000);

test("spinner probe", async () => {
  const setup = await createTestRenderer({ width: 90, height: 160 });
  mounted.push(setup);
  const shell = await mountShell({ renderer: setup.renderer, initialTheme: DARK_THEME, roles: deliveryChoices, openPath: () => undefined });
  shell.view.sync(state("retry"));
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await setup.flush();
    await Bun.sleep(47);
    for (const line of setup.captureSpans().lines) {
      const text = line.spans.map((s) => s.text).join("");
      if (text.includes("Retrying")) seen.add(JSON.stringify(text.trimEnd()));
    }
  }
  console.log([...seen].join("\n"));
}, 60_000);
