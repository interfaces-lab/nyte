/**
 * The one error sink. Every failure source calls `report`:
 * - the root Solid ErrorBoundary (render, memo and effect errors on the owner chain)
 * - per-part ErrorBoundaries around plugin renderers
 * - the runner (every effect handler)
 * - the store (a reducer or derive that throws keeps the previous state)
 * - `process.on("uncaughtException" | "unhandledRejection")`
 * Each report appends a timestamped entry with stack to the log file and
 * dispatches a `failure` fact; the screen shows it with the log path, and the
 * exit output lists it. The renderer runs with `openConsoleOnError: false`
 * and the app registers no frame callbacks, so no error goes to the overlay.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import type { FailureReport } from "../model/state.ts";
import type { CrashLog } from "./ports.ts";

const ROTATE_AT = 1024 * 1024;

/** `$NYTE_HOME/logs/tui.log`, appended synchronously (a crash may be the last thing that happens), rotated at 1 MB. */
export function openCrashLog(home: string): CrashLog {
  const path = join(home, "logs", "tui.log");

  return {
    path,
    write(origin, error) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        rotate(path);
        appendFileSync(path, entry(origin, error), { mode: 0o600 });
      } catch {
        // The log is the last resort; a failure to write it has nowhere else to go.
      }
    },
  };
}

export function createReporter(
  log: CrashLog,
  dispatch: (failure: FailureReport) => void,
): (origin: FailureReport["origin"], error: unknown) => void {
  return (origin, error) => {
    log.write(origin, error);
    dispatch({ origin, message: messageOf(error), logPath: log.path });
  };
}

export function installProcessHooks(
  report: (origin: FailureReport["origin"], error: unknown) => void,
): () => void {
  const onException = (error: unknown): void => report("process", error);
  const onRejection = (reason: unknown): void => report("process", reason);
  process.on("uncaughtException", onException);
  process.on("unhandledRejection", onRejection);

  return () => {
    process.off("uncaughtException", onException);
    process.off("unhandledRejection", onRejection);
  };
}

function entry(origin: string, error: unknown): string {
  const stack = error instanceof Error && error.stack !== undefined ? error.stack : String(error);
  const cause =
    error instanceof Error && error.cause !== undefined ? `\ncause: ${messageOf(error.cause)}` : "";

  return `${new Date().toISOString()} [${origin}] ${messageOf(error)}\n${stack}${cause}\n\n`;
}

function rotate(path: string): void {
  try {
    if (statSync(path).size >= ROTATE_AT) renameSync(path, `${path}.1`);
  } catch {
    // No file yet: nothing to rotate.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
