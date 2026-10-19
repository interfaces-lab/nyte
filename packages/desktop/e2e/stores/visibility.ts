import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { agentScript, newBuild, spawnIn } from "./builds.ts";
import { startChat, world } from "./fixture.ts";

const COUNT = Number(process.env.NYTE_VIS_COUNT ?? "200");

const build = newBuild();

await using scene = await world("visibility", build);

const session = await startChat(build, scene.home, "VISIBILITY chat");

const seenFile = join(scene.parent, "seen.json");

const sentFile = join(scene.parent, "sent.json");

const observer = spawnIn(
  "bun",
  [await agentScript(build, "observe.ts"), session, seenFile, String(COUNT)],
  {
    cwd: scene.home.cwd,
    env: scene.home.env,
  },
);

while (!observer.output().includes("observing")) await sleep(50);

const writer = spawnIn(
  "bun",
  [await agentScript(build, "write.ts"), session, sentFile, String(COUNT), "250"],
  {
    cwd: scene.home.cwd,
    env: scene.home.env,
  },
);

const wrote = await writer.exited;

const watched = await observer.exited;

if (wrote.code !== 0 || watched.code !== 0) throw new Error(`${wrote.stderr}\n${watched.stderr}`);

const Times = Type.Record(Type.String(), Type.Number());

const sent = Value.Parse(Times, JSON.parse(await readFile(sentFile, "utf8")));

const seen = Value.Parse(Times, JSON.parse(await readFile(seenFile, "utf8")));

const delays = Object.entries(sent)
  .flatMap(([text, at]) => {
    const observed = seen[text];

    return observed === undefined ? [] : [observed - at];
  })
  .sort((left, right) => left - right);

const quantile = (q: number): number =>
  delays[Math.min(delays.length - 1, Math.floor(q * delays.length))] ?? Number.NaN;

process.stdout.write(
  `${JSON.stringify({ samples: delays.length, missing: Object.keys(sent).length - delays.length, p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: delays.at(-1) })}\n`,
);
