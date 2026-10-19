import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { member, newBuild, print } from "./builds.ts";
import type { Spawned } from "./builds.ts";
import { bashTool, eventually, startChat, world } from "./fixture.ts";
import { endedRuns, firstEventAfter, leaseHolder, presencePid } from "./store.ts";

const ROUNDS = Number(process.env.NYTE_ORPHAN_ROUNDS ?? "20");

const build = newBuild();

await using scene = await world("orphans", build);

const marks = join(scene.parent, "marks.txt");

const session = await startChat(build, scene.home, "ORPHANS first chat");

const members: Spawned[] = [member(build, scene.home), member(build, scene.home)];

scene.defer(() => {
  for (const running of members) running.child.kill("SIGKILL");
});

const pickups: number[] = [];

for (let round = 0; round < ROUNDS; round += 1) {
  const token = `R${String(round)}`;

  const sender = print(build, scene.home, [
    "--session",
    session,
    bashTool(`echo ${token} >> ${marks}; sleep 40; echo done`),
  ]);

  await eventually(
    `round ${String(round)} started`,
    async () => (await readFile(marks, "utf8").catch(() => "")).includes(token),
    30_000,
  ).catch((cause: unknown) => {
    throw new Error(`${String(cause)}\nsender ${String(sender.pid)} said:\n${sender.output()}`);
  });
  const holder = await eventually("a holder", () => leaseHolder(scene.home.store, session), 10_000);
  const pid = await eventually("its pid", () => presencePid(scene.home.store, holder), 5_000);
  process.kill(pid, "SIGKILL");
  const killed = Date.now();

  if (pid !== sender.pid) sender.child.kill("SIGKILL");
  else members.push(member(build, scene.home));

  const ends = endedRuns(scene.home.store, session).length;
  await eventually(
    "the run ended",
    () => endedRuns(scene.home.store, session).length > ends || null,
    90_000,
  );
  const picked = firstEventAfter(scene.home.store, session, killed) ?? Number.NaN;
  pickups.push(picked - killed);
  process.stdout.write(
    `round ${String(round)}: picked up ${String(pickups.at(-1))} ms after the kill\n`,
  );
}

const sorted = [...pickups].sort((left, right) => left - right);

const quantile = (q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;

const repeated = (await readFile(marks, "utf8")).split("\n").filter((line) => line !== "");

process.stdout.write(
  `${JSON.stringify({ rounds: sorted.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1), commands: repeated.length, distinct: new Set(repeated).size })}\n`,
);
