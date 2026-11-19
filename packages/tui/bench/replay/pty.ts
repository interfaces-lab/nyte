import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Reply } from "@nyte-ai/bench";
import { TYPED } from "./content.ts";
import { SOAK_TURNS, soakReply } from "./world.ts";
import type { Scenario } from "./world.ts";

const SYNC_BEGIN = "\u001B[?2026h";

const SYNC_END = "\u001B[?2026l";

const WAIT_MS = 30_000;

const KEY_GAP_MS = 40;

const QUIET_MS = 400;

const IDLE_MS = 30_000;

const RESIZES = [
  [120, 40],
  [80, 24],
  [160, 50],
  [100, 32],
] as const;

const RESIZE_ROUNDS = 8;

export const SIZE = { width: 100, height: 32 } as const;

export interface Launch {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** One scenario's setup for one TUI: how to start it and what its screen shows. */
export interface Prepared extends AsyncDisposable {
  readonly launch: Launch;
  /** Text the first frame that shows the composer holds. */
  readonly painted: string;
  /** Text shown once the app takes input. */
  readonly ready: string;
  /** Text shown once a resumed chat's last turn has painted; null for a new chat. */
  readonly loaded: string | null;
  readonly streamEnd: string;
  readonly diffShown: string;
  readonly diffEnd: string;
  /** Where a preloaded probe writes frame stats on SIGUSR2; null without one. */
  readonly probe: string | null;
  scriptStream(): void;
  scriptDiff(): void;
  /** Queues `reply` as the answer to the next message. */
  script(reply: Reply): void;
}

export interface Frame {
  readonly start: number;
  readonly end: number;
  readonly bytes: number;
  readonly text: string;
}

export interface PtyResult {
  readonly scenario: Scenario;
  /** Epoch milliseconds the measured steps ran between. */
  readonly window: { readonly start: number; readonly end: number };
  /** Milliseconds per step: keystroke or resize to paint, spawn to paint, send to done. */
  readonly latencies: readonly number[];
  readonly frames: readonly {
    readonly bytes: number;
    readonly ms: number;
    readonly text?: string;
  }[];
  readonly bytes: number;
  readonly cpuMs: number;
  readonly rssMb: readonly number[];
  readonly probe: readonly (readonly number[])[] | null;
  readonly screen: string;
}

interface Term extends AsyncDisposable {
  readonly pid: number;
  readonly spawnedAt: number;
  readonly frames: Frame[];
  bytesSince(at: number): number;
  write(text: string): void;
  resize(width: number, height: number): Promise<void>;
  nextFrame(after: number, shows: (frame: Frame) => boolean, timeoutMs?: number): Promise<Frame>;
  quiet(ms: number, limitMs?: number): Promise<void>;
  screen(): Promise<string>;
  screenShows(text: string, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
  exited(limitMs: number): Promise<void>;
}

export async function runPty(prepared: Prepared, scenario: Scenario): Promise<PtyResult> {
  await using term = await openTerm(prepared.launch);
  const latencies: number[] = [];
  const rssMb: number[] = [];
  const debug = (what: string): void => {
    if (process.env["BENCH_DEBUG"] === "1")
      process.stderr.write(
        `${(performance.now() - term.spawnedAt).toFixed(0)} ${what} frames=${String(term.frames.length)}\n`,
      );
  };

  debug("spawned");
  const firstPaint = await term.nextFrame(0, (frame) => frame.text.includes(prepared.painted));
  debug("painted");

  await term.screenShows(prepared.ready);
  debug("ready");
  const readyAt = performance.now();

  if (prepared.loaded !== null) await term.screenShows(prepared.loaded);

  if (scenario === "cold") {
    latencies.push(firstPaint.end - term.spawnedAt, readyAt - term.spawnedAt);
    rssMb.push(processUsage(term.pid).rssMb);
  }

  await term.quiet(1_000);
  const from = performance.now();
  const frameCount = term.frames.length;
  const cpuBefore = processUsage(term.pid).cpuMs;
  rssMb.push(processUsage(term.pid).rssMb);

  await STEPS[scenario](term, prepared, latencies);
  const to = performance.now();

  await term.quiet(QUIET_MS);
  const usage = processUsage(term.pid);
  rssMb.push(usage.rssMb);
  const screen = await term.screen();
  const probe = await readProbe(term, prepared.probe);

  return {
    scenario,
    window: { start: performance.timeOrigin + from, end: performance.timeOrigin + to },
    latencies,
    frames: term.frames.slice(frameCount).map((frame) => ({
      bytes: frame.bytes,
      ms: frame.end - frame.start,
      ...(process.env["BENCH_FRAME_TEXT"] === "1" ? { text: frame.text } : {}),
    })),
    bytes: term.bytesSince(from),
    cpuMs: usage.cpuMs - cpuBefore,
    rssMb,
    probe: probe?.filter((sample) => (sample[0] ?? 0) >= performance.timeOrigin + from) ?? null,
    screen,
  };
}

type Step = (term: Term, prepared: Prepared, latencies: number[]) => Promise<void>;

const STEPS: Readonly<Record<Scenario, Step>> = {
  cold: async () => undefined,
  async typing(term, _prepared, latencies) {
    for (const char of TYPED) {
      const sent = performance.now();
      term.write(char);
      const painted = await term.nextFrame(
        sent,
        (frame) => char === " " || frame.text.includes(char),
        2_000,
      );
      latencies.push(painted.end - sent);
      await Bun.sleep(KEY_GAP_MS);
    }
  },
  async streaming(term, prepared, latencies) {
    prepared.scriptStream();
    term.write("Stream the plan.");
    await term.quiet(200);
    const sent = performance.now();
    term.write("\r");
    await term.screenShows(prepared.streamEnd);
    await term.quiet(QUIET_MS);
    latencies.push(performance.now() - QUIET_MS - sent);
  },
  async diff(term, prepared, latencies) {
    prepared.scriptDiff();
    term.write("Show the diff.");
    await term.quiet(200);
    const sent = performance.now();
    term.write("\r");
    const shown = await term.nextFrame(sent, (frame) => frame.text.includes(prepared.diffShown));
    latencies.push(shown.end - sent);
    await term.screenShows(prepared.diffEnd);
    await term.quiet(QUIET_MS);
    latencies.push(performance.now() - QUIET_MS - sent);
  },
  async resize(term, _prepared, latencies) {
    for (let round = 0; round < RESIZE_ROUNDS; round++) {
      for (const [width, height] of RESIZES) {
        const sent = performance.now();
        await term.resize(width, height);
        const painted = await term.nextFrame(sent, () => true, 2_000);
        latencies.push(painted.end - sent);
        await term.quiet(150);
      }
    }
  },
  async soak(term, prepared, latencies) {
    for (let turn = 0; turn < SOAK_TURNS; turn++) {
      const next = soakReply(turn);
      prepared.script(next.reply);
      term.write(`Soak turn ${String(turn)}.`);
      await term.quiet(100, 500);
      term.write("\r");
      await term.screenShows(next.shown);
      await term.quiet(200, 1_000);
      latencies.push(processUsage(term.pid).rssMb);
    }
  },
  idle: sitIdle,
  welcome: sitIdle,
};

async function sitIdle(term: Term, _prepared: Prepared, latencies: number[]): Promise<void> {
  const before = term.frames.length;
  await Bun.sleep(IDLE_MS);
  latencies.push(term.frames.length - before);
}

async function openTerm(launch: Launch): Promise<Term> {
  const setup = await createTestRenderer({ width: SIZE.width, height: SIZE.height });
  const frames: Frame[] = [];
  const arrivals: { readonly at: number; readonly bytes: number }[] = [];
  const waiters = new Set<() => void>();
  let pending = "";
  let pendingBytes = 0;
  let open: { start: number; bytes: number; text: string } | null = null;
  let terminal: Bun.Terminal | undefined;

  const emulator = new EmbeddedTerminalRenderable(setup.renderer, {
    width: SIZE.width,
    height: SIZE.height,
    cols: SIZE.width,
    rows: SIZE.height,
    onData: (data) => terminal?.write(data),
  });

  setup.renderer.root.add(emulator);

  const take = (at: number, data: Uint8Array): void => {
    arrivals.push({ at, bytes: data.byteLength });
    emulator.write(data);
    pending += Buffer.from(data).toString("latin1");
    pendingBytes += data.byteLength;

    for (;;) {
      if (open === null) {
        const begin = pending.indexOf(SYNC_BEGIN);

        if (begin < 0) {
          const keep = Math.min(pending.length, SYNC_BEGIN.length - 1);
          pending = pending.slice(pending.length - keep);
          pendingBytes = keep;
          break;
        }

        open = { start: at, bytes: 0, text: "" };
        pending = pending.slice(begin);
        pendingBytes = pending.length;
      }

      const end = pending.indexOf(SYNC_END);

      if (end < 0) break;
      const body = pending.slice(0, end + SYNC_END.length);
      frames.push({
        start: open.start,
        end: at,
        bytes: body.length,
        text: stripVTControlCharacters(Buffer.from(body, "latin1").toString("utf8")),
      });
      open = null;
      pending = pending.slice(end + SYNC_END.length);
      pendingBytes = pending.length;
    }

    for (const waiter of waiters) waiter();
  };

  const child = Bun.spawn([...launch.argv], {
    cwd: launch.cwd,
    env: { ...launch.env },
    detached: true,
    terminal: {
      cols: SIZE.width,
      rows: SIZE.height,
      data: (_terminal, data) => take(performance.now(), data),
    },
  });

  const spawnedAt = performance.now();
  terminal = child.terminal;

  const waitUntil = <T>(
    check: () => T | undefined,
    timeoutMs: number,
    what: string,
  ): Promise<T> => {
    const found = check();

    if (found !== undefined) return Promise.resolve(found);
    const matched = Promise.withResolvers<T>();

    const waiter = (): void => {
      const value = check();

      if (value !== undefined) matched.resolve(value);
    };

    const timer = setTimeout(() => {
      void (async () => {
        matched.reject(new Error(`Timed out waiting for ${what}. Screen:\n${await screen()}`));
      })();
    }, timeoutMs);

    waiters.add(waiter);

    return matched.promise.finally(() => {
      clearTimeout(timer);
      waiters.delete(waiter);
    });
  };

  const screen = async (): Promise<string> => {
    await setup.renderOnce();

    return emulator.screen().text;
  };

  const stop = async (): Promise<void> => {
    const tree = [...descendants(child.pid), child.pid];

    for (const pid of [-child.pid, ...tree]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
      }
    }

    await child.exited;
  };

  return {
    pid: child.pid,
    spawnedAt,
    frames,
    bytesSince: (at) =>
      arrivals
        .filter((arrival) => arrival.at >= at)
        .reduce((sum, arrival) => sum + arrival.bytes, 0),
    write: (text) => terminal?.write(text),
    async resize(width, height) {
      terminal?.resize(width, height);
      emulator.width = width;
      emulator.height = height;
      setup.resize(width, height);
    },
    nextFrame: (after, shows, timeoutMs = WAIT_MS) =>
      waitUntil(
        () => frames.find((frame) => frame.start >= after && shows(frame)),
        timeoutMs,
        "a frame",
      ),
    async quiet(ms, limitMs = 3_000) {
      const limit = performance.now() + limitMs;

      for (;;) {
        const idle = performance.now() - (arrivals.at(-1)?.at ?? 0);

        if (idle >= ms || performance.now() >= limit) return;
        await Bun.sleep(Math.min(ms - idle, limit - performance.now()));
      }
    },
    screen,
    async screenShows(text, timeoutMs = WAIT_MS) {
      const deadline = performance.now() + timeoutMs;

      while (!(await screen()).includes(text)) {
        if (performance.now() > deadline)
          throw new Error(`Timed out waiting for "${text}". Screen:\n${await screen()}`);
        await Bun.sleep(10);
      }
    },
    stop,
    async exited(limitMs) {
      await Promise.race([child.exited, Bun.sleep(limitMs)]);
    },
    async [Symbol.asyncDispose]() {
      await stop();
      terminal?.close();
      await setup.dispose();
    },
  };
}

async function readProbe(term: Term, path: string | null): Promise<number[][] | null> {
  if (path === null) return null;
  process.kill(term.pid, "SIGUSR2");
  const deadline = performance.now() + 5_000;

  while (!existsSync(path)) {
    if (performance.now() > deadline) throw new Error("The probe never wrote its samples.");
    await Bun.sleep(20);
  }

  await term.exited(5_000);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  if (typeof parsed !== "object" || parsed === null || !("samples" in parsed))
    throw new Error("The probe wrote no samples.");
  const samples: unknown = parsed.samples;

  if (!Array.isArray(samples)) throw new Error("The probe's samples are not a list.");

  return samples.filter((row): row is number[] => Array.isArray(row));
}

function descendants(pid: number): number[] {
  const listed = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const rows = listed.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number));
  const found = new Set([pid]);

  for (let grew = true; grew;) {
    grew = false;

    for (const [child, parent] of rows) {
      if (child !== undefined && parent !== undefined && found.has(parent) && !found.has(child)) {
        found.add(child);
        grew = true;
      }
    }
  }

  found.delete(pid);

  return [...found];
}

/** CPU time and resident memory of `pid` alone, from `ps`: a server it starts is not the TUI. */
export function processUsage(pid: number): { readonly cpuMs: number; readonly rssMb: number } {
  const listed = spawnSync("ps", ["-o", "rss=,time=", "-p", String(pid)], { encoding: "utf8" });
  const [rss, time] = listed.stdout.trim().split(/\s+/u);

  return { cpuMs: cpuTime(time ?? "0:0"), rssMb: Number(rss ?? 0) / 1024 };
}

function cpuTime(text: string): number {
  const parts = text.split(":").map(Number);

  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}
