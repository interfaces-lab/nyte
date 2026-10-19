import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { binary, makeHome, newBuild, seed, spawnIn } from "./builds.ts";
import type { Spawned } from "./builds.ts";
import { checkHistory } from "./checker.ts";
import type { HarnessEvent } from "./checker.ts";
import { defaultScript, serveModel } from "./model-server.ts";
import type { Answer, Asked } from "./model-server.ts";

const SEED = Number(process.env.NYTE_CHAOS_SEED ?? "1");

const CHAOS_MS = Number(process.env.NYTE_CHAOS_MS ?? String(6 * 60_000));

const CHATS = 4;

const MAX_MEMBERS = 3;

function prng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = prng(SEED);

const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)];

const build = newBuild();

const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-chaos-")));

const marks = join(parent, "marks.txt");

const script = (asked: Asked): Answer => {
  if (asked.title || !asked.user.startsWith("WORK") || asked.tool !== null)
    return defaultScript(asked);
  const token = `T${crypto.randomUUID()}`;
  const seconds = 1 + Math.floor(Math.random() * 4);

  return {
    kind: "tool",
    name: "bash",
    input: {
      command: `echo ${token} >> ${marks}; sleep ${String(seconds)}; echo ${token}`,
      description: "chaos work",
    },
  };
};

await using model = await serveModel(script);

const home = await makeHome(parent, model);

const env = { ...home.env, NYTE_STORE_AUDIT: "1" };

const audited = { ...home, env };

await seed(build, audited);

const history: HarnessEvent[] = [];

const record = (event: Omit<HarnessEvent, "at">): void =>
  void history.push({ ...event, at: Date.now() });

interface Running {
  readonly kind: "member" | "sender";
  readonly spawned: Spawned;
  paused: boolean;
  done: boolean;
  readonly text?: string;
  readonly session?: string;
}

const running: Running[] = [];

const launch = (kind: Running["kind"], session?: string, text?: string): Running => {
  const args =
    kind === "member"
      ? ["serve", "--port", "0", "--token", "chaos-token-chaos-token"]
      : ["-p", "--session", session ?? "", text ?? ""];

  const spawned = spawnIn(process.env.NYTE_BUN ?? "bun", [binary(build), ...args], {
    cwd: home.cwd,
    env,
  });

  const entry: Running = { kind, spawned, paused: false, done: false, text, session };
  running.push(entry);
  record({ kind: "launch", pid: spawned.pid, role: kind, session, text });
  void spawned.exited.then((exited) => {
    entry.done = true;
    record({
      kind: "exit",
      pid: spawned.pid,
      role: kind,
      code: exited.code,
      signal: exited.signal,
      session,
      text,
      output: kind === "sender" ? `${exited.stdout}${exited.stderr}`.slice(-600) : undefined,
    });
  });

  return entry;
};

const sessions: string[] = [];

for (let index = 0; index < CHATS; index += 1) {
  const created = spawnIn(
    process.env.NYTE_BUN ?? "bun",
    [binary(build), "-p", `CHAT ${String(index)}`],
    {
      cwd: home.cwd,
      env,
    },
  );

  const exited = await created.exited;
  const session = /session (\S+) ·/u.exec(`${exited.stdout}${exited.stderr}`)?.[1];

  if (session === undefined)
    throw new Error(`Could not create a chat:\n${exited.stdout}${exited.stderr}`);
  sessions.push(session);
}

launch("member");

launch("member");

await sleep(3_000);

const alive = (): Running[] => running.filter((entry) => !entry.done);

const signal = (entry: Running, name: NodeJS.Signals): void => {
  try {
    process.kill(entry.spawned.pid, name);
  } catch {
    return;
  }
};

let work = 0;

const started = Date.now();

while (Date.now() - started < CHAOS_MS) {
  await sleep(1_500 + Math.floor(random() * 3_500));
  const roll = random();
  const members = alive().filter((entry) => entry.kind === "member");

  if (roll < 0.4) {
    const session = pick(sessions) ?? "";
    work += 1;
    launch("sender", session, `WORK ${String(work)}`);
  } else if (roll < 0.5 && members.length < MAX_MEMBERS) {
    launch("member");
  } else if (roll < 0.75) {
    const victim = pick(alive().filter((entry) => !entry.paused));

    if (victim === undefined || (victim.kind === "member" && members.length <= 1)) continue;
    signal(victim, "SIGKILL");
    record({ kind: "kill", pid: victim.spawned.pid, role: victim.kind });
  } else {
    const victim = pick(alive().filter((entry) => !entry.paused));

    if (victim === undefined) continue;
    const ms = 2_000 + Math.floor(random() * 43_000);
    victim.paused = true;
    signal(victim, "SIGSTOP");
    record({ kind: "pause", pid: victim.spawned.pid, role: victim.kind, ms });
    void sleep(ms).then(() => {
      victim.paused = false;
      signal(victim, "SIGCONT");
      record({ kind: "resume", pid: victim.spawned.pid, role: victim.kind });
    });
  }
}

record({ kind: "quiesce" });

for (const entry of alive())
  if (entry.paused) {
    signal(entry, "SIGCONT");
    entry.paused = false;
    record({ kind: "resume", pid: entry.spawned.pid, role: entry.kind });
  }

if (alive().every((entry) => entry.kind !== "member")) launch("member");

await sleep(90_000);

for (const entry of alive()) {
  signal(entry, "SIGTERM");
  record({ kind: "stop", pid: entry.spawned.pid, role: entry.kind });
}

await Promise.all(running.map((entry) => entry.spawned.exited));

await writeFile(join(parent, "history.json"), JSON.stringify(history, null, 2));

const report = checkHistory({ store: home.store, marks, history, seed: SEED });

await writeFile(join(parent, "report.json"), JSON.stringify(report, null, 2));

process.stdout.write(`${JSON.stringify({ parent, ...report.summary }, null, 2)}\n`);

for (const violation of report.violations.slice(0, 40))
  process.stdout.write(`VIOLATION ${violation}\n`);

process.exitCode = report.violations.length === 0 ? 0 : 1;
