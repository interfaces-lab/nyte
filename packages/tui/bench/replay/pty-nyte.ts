import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { freshHome } from "../../qa/service.ts";
import { runPty } from "./pty.ts";
import type { Prepared } from "./pty.ts";
import {
  DIFF_END,
  HISTORY,
  loadedText,
  openWorld,
  parseScenario,
  scriptDiff,
  scriptStream,
  STREAM_END,
} from "./world.ts";

const tui = fileURLToPath(new URL("../../", import.meta.url));

const target = process.argv[2];

const scenario = parseScenario(process.argv[3]);

const out = process.env["BENCH_OUT"];

const profileDir = process.env["BENCH_CPU_PROF_DIR"];

if (target !== "binary" && target !== "source") throw new Error("Name a target: binary, source.");

await using world = await openWorld(HISTORY[scenario]);

await using home = await freshHome();

const probe = target === "source" ? join(home.cwd, "..", "probe.json") : null;

const flags = [
  "--host-url",
  world.fixture.endpoint.url,
  ...(world.session === null ? [] : ["--session", world.session]),
];

const binary = process.env["NYTE_BINARY"] ?? join(tui, "dist/nyte");

const argv =
  target === "binary"
    ? [binary, ...flags]
    : [
        process.execPath,
        ...(profileDir === undefined ? [] : ["--cpu-prof", `--cpu-prof-dir=${profileDir}`]),
        "--preload",
        join(tui, "dev/preload.ts"),
        "--preload",
        join(tui, "bench/replay/probe.ts"),
        join(tui, "src/index.ts"),
        ...flags,
      ];

const prepared: Prepared = {
  launch: {
    argv,
    cwd: home.cwd,
    env: {
      ...home.env,
      NYTE_HOST_TOKEN: world.fixture.endpoint.token,
      NYTE_RELOAD: "off",
      INIT_CWD: home.cwd,
      ...(probe === null ? {} : { BENCH_PROBE_OUT: probe }),
    },
  },
  painted: "❯",
  ready: "ctrl+p model",
  loaded: world.session === null ? null : loadedText(HISTORY[scenario]),
  streamEnd: STREAM_END,
  diffShown: "value1497 = 2994",
  diffEnd: DIFF_END,
  probe,
  scriptStream: () => scriptStream(world.fixture),
  scriptDiff: () => scriptDiff(world.fixture),
  script: (reply) => world.fixture.reply(reply),
  [Symbol.asyncDispose]: async () => undefined,
};

const result = await runPty(prepared, scenario);

if (out === undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
else writeFileSync(out, JSON.stringify(result));

process.exit(0);
