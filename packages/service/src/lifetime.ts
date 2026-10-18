import { execFile } from "node:child_process";
import process from "node:process";
import { buildOperations } from "./build.ts";
import type { Attachment, Busy, Handoff, ServiceClient } from "./routes.ts";

const encoder = new TextEncoder();

export const IDLE_GRACE_MS = 5 * 60_000;

export interface Timers {
  wait(callback: () => void, ms: number): () => void;
}

export interface LifetimeOptions {
  readonly grace: number;
  readonly timers: Timers;
  readonly idle: () => void;
}

export const REAL_TIMERS: Timers = {
  wait(callback, ms) {
    const timer = setTimeout(callback, ms);

    return () => clearTimeout(timer);
  },
};

export function terminate(): void {
  process.kill(process.pid, "SIGTERM");
}

export class Lifetime {
  readonly #options: LifetimeOptions;
  readonly #working: () => Promise<boolean>;
  readonly #staying: () => Promise<boolean>;
  readonly #attached = new Map<Attachment, (handoff: Handoff) => void>();
  #cancel: (() => void) | undefined;
  #ended = false;

  constructor(
    options: LifetimeOptions,
    working: () => Promise<boolean>,
    staying: () => Promise<boolean>,
  ) {
    this.#options = options;
    this.#working = working;
    this.#staying = staying;
    this.#arm();
  }

  attach(attachment: Attachment, signal: AbortSignal): Response {
    const entry = { ...attachment };
    let released = false;

    const release = (): void => {
      if (released) return;
      released = true;
      this.#attached.delete(entry);

      if (this.#attached.size === 0) this.#arm();
    };

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#attached.set(entry, (handoff) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(handoff)}\n`));
          controller.close();
          release();
        });
      },
      cancel: release,
    });

    this.#cancel?.();
    this.#cancel = undefined;
    signal.addEventListener("abort", release, { once: true });

    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  async clients(): Promise<readonly ServiceClient[]> {
    const attached = [...this.#attached.keys()];
    const terminals = await terminalsByPid(attached.map((entry) => entry.pid));

    return attached.map((entry) => ({ ...entry, tty: terminals.get(entry.pid) ?? null }));
  }

  async retire(caller: number, takeover?: string): Promise<Busy | undefined> {
    const holding = (): number =>
      [...this.#attached.keys()].filter(
        (entry) =>
          entry.pid !== caller &&
          !(takeover !== undefined && entry.follows && buildOperations(entry.build) === takeover),
      ).length;

    const working = holding() === 0 && (await this.#working().catch(() => true));

    if (holding() > 0 || working) return { clients: holding(), working };

    if (takeover !== undefined)
      for (const hand of this.#attached.values()) hand({ kind: "retiring", to: "desktop" });
    this.close();
    this.#options.timers.wait(this.#options.idle, 0);

    return undefined;
  }

  close(): void {
    this.#ended = true;
    this.#cancel?.();
    this.#cancel = undefined;
  }

  #arm(): void {
    if (this.#ended) return;
    this.#cancel?.();
    this.#cancel = this.#options.timers.wait(() => void this.#check(), this.#options.grace);
  }

  async #check(): Promise<void> {
    this.#cancel = undefined;

    if (this.#ended || this.#attached.size > 0) return;
    const kept = await Promise.all([this.#staying(), this.#working()]).then(
      (reasons) => reasons.includes(true),
      () => true,
    );

    if (this.#ended || this.#attached.size > 0) return;

    if (kept) {
      this.#arm();

      return;
    }

    this.#ended = true;
    this.#options.idle();
  }
}

async function terminalsByPid(pids: readonly number[]): Promise<ReadonlyMap<number, string>> {
  if (pids.length === 0) return new Map();

  const listed = await new Promise<string>((done) => {
    execFile("ps", ["-o", "pid=,tty=", "-p", [...new Set(pids)].join(",")], (_error, stdout) =>
      done(stdout),
    );
  });

  return new Map(
    listed.split("\n").flatMap((line) => {
      const [pid = "", tty = ""] = line.trim().split(/\s+/u);

      return tty === "" || tty.startsWith("?") ? [] : [[Number(pid), tty] as const];
    }),
  );
}
