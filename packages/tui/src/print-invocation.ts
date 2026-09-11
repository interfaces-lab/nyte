import process from "node:process";
import type { SessionId } from "@nyte-ai/core";
import { reportPrintOutcome } from "./print.ts";
import type { PrintOutcome, PrintOutput } from "./print.ts";
import type { HostCloseOutcome } from "./host.ts";

type Cleanup = () => void | HostCloseOutcome | Promise<void | HostCloseOutcome>;

export interface PrintFailure {
  readonly phase: "cleanup" | "diagnostic" | "terminal";
  readonly cause: unknown;
}

/** Owns startup signals and emits the terminal record only after cleanup settles. */
export class PrintInvocation {
  readonly controller = new AbortController();
  sessionId: SessionId | undefined;
  private readonly cleanups: Cleanup[] = [];
  private readonly recordedFailures: PrintFailure[] = [];
  private readonly output: PrintOutput;
  private readonly json: boolean;
  private received: "SIGINT" | "SIGTERM" | undefined;
  private finishing: Promise<number | undefined> | undefined;

  /** Local diagnostics only. Unknown causes are never serialized into CLI output. */
  get failures(): readonly PrintFailure[] {
    return this.recordedFailures;
  }

  constructor(options: { readonly json: boolean; readonly output: PrintOutput }) {
    this.json = options.json;
    this.output = options.output;
    process.on("SIGINT", this.interrupt);
    process.on("SIGTERM", this.terminate);
  }

  private readonly interrupt = (): void => this.cancel("SIGINT");
  private readonly terminate = (): void => this.cancel("SIGTERM");

  private cancel(signal: "SIGINT" | "SIGTERM"): void {
    this.received ??= signal;
    this.controller.abort(new Error(`Received ${signal}`));
  }

  defer(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  /** The TUI installs and owns its own signal handlers. */
  handoff(): void {
    process.off("SIGINT", this.interrupt);
    process.off("SIGTERM", this.terminate);
  }

  finish(outcome?: PrintOutcome): Promise<number | undefined> {
    this.finishing ??= Promise.resolve().then(() => this.complete(outcome));
    return this.finishing;
  }

  private async complete(outcome: PrintOutcome | undefined): Promise<number | undefined> {
    let terminal =
      this.received === undefined
        ? outcome
        : ({ kind: "cancelled", signal: this.received } satisfies PrintOutcome);
    for (const cleanup of this.cleanups.toReversed()) {
      try {
        const closed = await cleanup();
        if (closed?.kind === "failed") {
          for (const failure of closed.failures) {
            this.recordedFailures.push({ phase: "cleanup", cause: failure.cause });
          }
        }
      } catch (cause) {
        this.recordedFailures.push({ phase: "cleanup", cause });
      }
    }
    this.handoff();
    if (this.recordedFailures.length > 0) {
      terminal = { kind: "failed", code: "cleanup_failed", message: "Resource cleanup failed." };
      // A broken diagnostic sink must not prevent cleanup or the machine terminal record.
      try {
        this.output.error("Resource cleanup failed.");
      } catch (cause) {
        this.recordedFailures.push({ phase: "diagnostic", cause });
      }
    }
    // A signal can arrive while cleanup is pending, but cannot hide cleanup failure.
    if (this.received !== undefined && terminal?.kind !== "failed") {
      terminal = { kind: "cancelled", signal: this.received };
    }
    if (terminal === undefined) return undefined;
    try {
      return reportPrintOutcome(terminal, {
        sessionId: this.sessionId,
        json: this.json,
        output: this.output,
      });
    } catch (cause) {
      this.recordedFailures.push({ phase: "terminal", cause });
      throw cause;
    }
  }
}
