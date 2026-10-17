import { execFile } from "node:child_process";
import process from "node:process";
import type { Attachment, ServiceClient } from "./routes.ts";

/**
 * How long the service runs with no attached client before it stops: five minutes. Long
 * enough that quitting and relaunching `nyte`, `nyte update`, or a script running one
 * command after another reuses the warm host instead of paying its cold start (store,
 * plugins, MCP servers) each time; short enough that a service nobody uses is gone within
 * minutes rather than running for days on old code.
 */
export const IDLE_GRACE_MS = 5 * 60_000;

/** Schedules the idle checks: `wait` calls `callback` after `ms` and returns what cancels it. */
export interface Timers {
  wait(callback: () => void, ms: number): () => void;
}

/** When the service stops on its own: after `grace` ms with no attached client and no work, it calls `idle`. */
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

/** The default stop: SIGTERM to the service's own process, the signal `nyte service stop` sends, so `nyte service run` shuts down the way it does then. */
export function terminate(): void {
  process.kill(process.pid, "SIGTERM");
}

/**
 * Counts the client processes attached to the service and stops it once none has been
 * attached for the grace period, unless `working` reports a reason to stay (the service
 * installed, Connect linked, a run driving or a job alive), in which case it checks again
 * a grace period later.
 */
export class Lifetime {
  readonly #options: LifetimeOptions;
  readonly #working: () => Promise<boolean>;
  readonly #attached = new Set<Attachment>();
  #cancel: (() => void) | undefined;
  #ended = false;

  constructor(options: LifetimeOptions, working: () => Promise<boolean>) {
    this.#options = options;
    this.#working = working;
    this.#arm();
  }

  /** Holds `attachment` until the client's connection ends, which the returned stream's cancel or `signal` reports. */
  attach(attachment: Attachment, signal: AbortSignal): Response {
    const entry = { ...attachment };
    let released = false;

    const release = (): void => {
      if (released) return;
      released = true;
      this.#attached.delete(entry);

      if (this.#attached.size === 0) this.#arm();
    };

    this.#attached.add(entry);
    this.#cancel?.();
    this.#cancel = undefined;
    signal.addEventListener("abort", release, { once: true });

    return new Response(new ReadableStream<Uint8Array>({ cancel: release }), {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  /** Lists the attached clients with each one's terminal. */
  async clients(): Promise<readonly ServiceClient[]> {
    const attached = [...this.#attached];
    const terminals = await terminalsByPid(attached.map((entry) => entry.pid));

    return attached.map((entry) => ({ ...entry, tty: terminals.get(entry.pid) ?? null }));
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
    const working = await this.#working().catch(() => true);

    if (this.#ended || this.#attached.size > 0) return;

    if (working) {
      this.#arm();

      return;
    }

    this.#ended = true;
    this.#options.idle();
  }
}

/** Reads each pid's controlling terminal from `ps`; a pid without one, a gone pid, or a failed `ps` has no entry. */
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
