import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { openFixture } from "./fixture.ts";
import type { Fixture, TranscriptSize } from "./fixture.ts";
import { scenarios } from "./scenarios.ts";

const { values } = parseArgs({
  options: {
    show: { type: "boolean", default: false },
    record: { type: "string" },
    filter: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  process.stdout.write(
    "TUI QA: all slash commands, aliases, settings, and shortcuts with short and long transcripts.\n\n--show          Play the same assertions in your terminal\n--record <dir>  Save rendered frames and results\n--filter <text> Run matching scenarios\n",
  );
  process.exit(0);
}
if (values.show && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  process.stderr.write(
    "Visible playback needs a terminal. Run pnpm --dir packages/tui test:tui:show in your terminal.\n",
  );
  process.exit(1);
}
const selected = scenarios.filter(
  (scenario) => values.filter === undefined || scenario.name.includes(values.filter),
);
if (selected.length === 0) throw new Error(`No scenarios match ${values.filter}`);
const directory = values.record === undefined ? undefined : resolve(values.record);
if (directory !== undefined) await mkdir(directory, { recursive: true });
const results: { name: string; transcript: TranscriptSize; passed: boolean; error?: string }[] = [];
let active: Fixture | undefined;
let interrupted = false;
const stop = () => {
  interrupted = true;
  active?.cancel();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  matrix: for (const size of ["short", "long"] satisfies TranscriptSize[]) {
    for (const scenario of selected) {
      if (interrupted) break matrix;
      process.stdout.write(
        `${results.length + 1}/${selected.length * 2} ${size} ${scenario.name}\n`,
      );
      let failure: string | undefined;
      try {
        active = await openFixture(
          size,
          values.show ? "show" : "headless",
          directory !== undefined,
        );
        active.renderer.setTerminalTitle(
          `TUI QA ${results.length + 1}/${selected.length * 2} · ${size} · ${scenario.name}`,
        );
        await active.pause();
        await scenario.run(active);
        await active.pause();
      } catch (cause) {
        failure = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      } finally {
        if (active !== undefined) {
          interrupted ||= active.wasInterrupted();
          try {
            if (directory !== undefined) {
              const name = `${size}-${scenario.name.replaceAll(/[^a-zA-Z0-9-]/g, "_")}.json`;
              await writeFile(
                join(directory, name),
                JSON.stringify(
                  {
                    name: scenario.name,
                    transcript: size,
                    frames: active.recordedFrames(),
                    finalFrame: active.frame(),
                    error: failure,
                  },
                  null,
                  2,
                ),
              );
            }
          } finally {
            await active.close();
            active = undefined;
          }
        }
      }
      results.push(
        failure === undefined
          ? { name: scenario.name, transcript: size, passed: true }
          : { name: scenario.name, transcript: size, passed: false, error: failure },
      );
      process.stdout.write(failure === undefined ? "PASS\n" : `FAIL ${failure}\n`);
    }
  }
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
const failed = results.filter((result) => !result.passed);
if (directory !== undefined)
  await writeFile(join(directory, "results.json"), JSON.stringify(results, null, 2));
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} passed; ${failed.length} failed.\n`,
);
if (interrupted) process.stdout.write("Playback stopped.\n");
process.exitCode = interrupted ? 130 : failed.length === 0 ? 0 : 1;
