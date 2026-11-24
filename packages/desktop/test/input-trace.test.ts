import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readInputTrace } from "../e2e/input-trace.ts";

test("render phases include the whole renderer run while key latency uses the marked window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-input-trace-"));

  try {
    const path = join(directory, "trace.json");
    await writeFile(
      path,
      JSON.stringify({
        traceEvents: [
          {
            name: "AnimationFrame::Render",
            ph: "b",
            ts: 0,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "e",
            ts: 500,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          { name: "typing:start", ph: "I", ts: 1000, pid: 1, tid: 10 },
          {
            name: "EventTiming",
            ph: "b",
            ts: 2000,
            pid: 1,
            tid: 10,
            id: "key",
            args: { data: { type: "keydown" } },
          },
          {
            name: "AnimationFrame::Render",
            ph: "b",
            ts: 3000,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "b",
            ts: 4000,
            pid: 2,
            tid: 10,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "b",
            ts: 4000,
            pid: 1,
            tid: 20,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "e",
            ts: 7000,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          { name: "EventTiming", ph: "e", ts: 14_000, pid: 1, tid: 10, id: "key" },
          { name: "typing:end", ph: "I", ts: 15_000, pid: 1, tid: 10 },
          {
            name: "AnimationFrame::Render",
            ph: "b",
            ts: 16_000,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "e",
            ts: 34_000,
            pid: 1,
            tid: 10,
            id2: { local: "frame" },
          },
          { name: "AnimationFrame::Render", ph: "X", ts: 35_000, dur: 2500, pid: 1, tid: 10 },
          { name: "AnimationFrame::Render", ph: "B", ts: 40_000, pid: 1, tid: 10 },
          { name: "AnimationFrame::Render", ph: "E", ts: 43_000, pid: 1, tid: 10 },
          {
            name: "AnimationFrame::Render",
            ph: "e",
            ts: 500_000,
            pid: 2,
            tid: 10,
            id2: { local: "frame" },
          },
          {
            name: "AnimationFrame::Render",
            ph: "e",
            ts: 500_000,
            pid: 1,
            tid: 20,
            id2: { local: "frame" },
          },
        ],
      }),
    );
    const trace = await readInputTrace(path, { start: "typing:start", end: "typing:end" });

    expect(trace.keydownMs).toEqual([12]);
    expect(trace.renderingMs).toEqual([0.5, 4, 18, 2.5, 3]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a trace without renderer phases fails instead of reporting an empty rendering distribution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-input-trace-"));

  try {
    const path = join(directory, "trace.json");
    await writeFile(
      path,
      JSON.stringify({
        traceEvents: [
          { name: "typing:start", ph: "I", ts: 0, pid: 1, tid: 10 },
          {
            name: "EventTiming",
            ph: "b",
            ts: 1000,
            pid: 1,
            tid: 10,
            id: "key",
            args: { data: { type: "keydown" } },
          },
          { name: "EventTiming", ph: "e", ts: 6000, pid: 1, tid: 10, id: "key" },
          { name: "typing:end", ph: "I", ts: 8000, pid: 1, tid: 10 },
          { name: "AnimationFrame::Render", ph: "X", ts: 2000, dur: 1000, pid: 2, tid: 10 },
        ],
      }),
    );

    await expect(
      readInputTrace(path, { start: "typing:start", end: "typing:end" }),
    ).rejects.toThrow(
      "The trace has no complete AnimationFrame::Render phases on the renderer thread",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
