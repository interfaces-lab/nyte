import type { Execution, RunId } from "@nyte-ai/sdk";
import { singleLine } from "./format.ts";

export type ProgramStatus =
  | { readonly state: "idle" | "working" | "done" }
  | {
      readonly state: "blocked";
      readonly kind: "permission" | "question" | "auth";
      readonly msg: string;
    }
  | { readonly state: "error"; readonly msg: string };

const OSC = "\u001B]7501;";

const ST = "\u001B\\";

const MSG_MAX_BYTES = 2048;

export const CLEARED = `${OSC}state=clear${ST}`;

/** What a run reports while nothing waits on the user: `done` or `error` only for the run the user watched and hasn't dismissed. */
export function readProgramStatus(
  execution: Execution | undefined,
  watched: RunId | null,
): ProgramStatus {
  if (execution === undefined) return { state: "idle" };

  if (execution.kind !== "idle") return { state: "working" };
  const last = execution.lastRun;

  if (last === null || last.id !== watched) return { state: "idle" };

  if (last.end.kind === "failed") return { state: "error", msg: last.end.failure.message };

  return { state: last.end.kind === "completed" ? "done" : "idle" };
}

export function encode(status: ProgramStatus): string {
  const pairs = [`state=${status.state}`, "app=nyte"];

  if (status.state === "blocked") pairs.push(`kind=${status.kind}`);

  if (status.state === "blocked" || status.state === "error") {
    const msg = message(status.msg);

    if (msg !== undefined) pairs.push(`msg=${msg}`);
  }

  return `${OSC}${pairs.join(":")}${ST}`;
}

function message(text: string): string | undefined {
  const clean = singleLine(text);

  if (clean === "") return undefined;

  if (Buffer.byteLength(clean) <= MSG_MAX_BYTES) return Buffer.from(clean).toString("base64");
  const budget = MSG_MAX_BYTES - Buffer.byteLength("…");
  let kept = "";
  let bytes = 0;

  for (const char of clean) {
    bytes += Buffer.byteLength(char);

    if (bytes > budget) break;
    kept += char;
  }

  return Buffer.from(`${kept}…`).toString("base64");
}
