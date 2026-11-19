import { writeFileSync } from "node:fs";
import process from "node:process";
import { CliRenderer, CliRenderEvents } from "@opentui/core";

const out = process.env["BENCH_PROBE_OUT"];

if (out === undefined) throw new Error("Set BENCH_PROBE_OUT to the file the probe writes.");

const samples: number[][] = [];

let watched: CliRenderer | null = null;

// oxlint-disable-next-line typescript/unbound-method -- called with the renderer as `this` below
const setupTerminal = CliRenderer.prototype.setupTerminal;

CliRenderer.prototype.setupTerminal = function setupWatched(this: CliRenderer) {
  if (watched === null) watch(this);

  return setupTerminal.call(this);
};

function watch(renderer: CliRenderer): void {
  watched = renderer;
  renderer.setGatherStats(true);
  renderer.on(CliRenderEvents.FRAME, () => {
    const stats = renderer.getStats();

    samples.push([
      performance.timeOrigin + performance.now(),
      stats.frameTimes.at(-1) ?? 0,
      renderer["_lastSceneTimeMs"],
      stats.nativeRenderTime ?? 0,
      stats.nativeStdoutWriteTime ?? 0,
      stats.cellsUpdated,
    ]);
  });
}

process.on("SIGUSR2", () => {
  writeFileSync(
    out,
    JSON.stringify({ columns: ["at", "frame", "scene", "diffUs", "writeUs", "cells"], samples }),
  );
  watched?.destroy();
  setTimeout(() => process.exit(0), 100);
});
