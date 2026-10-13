import type { Execution, RunId } from "@nyte-ai/sdk";
import { singleLine } from "./format.ts";

/** What the followed session is doing right now. */
export interface Activity {
  readonly busy: boolean;
  readonly execution: Execution | undefined;
  /** The ask in front of the user, from the followed session or one of its sub-agents. */
  readonly question: string | undefined;
}

export type ProgramStatus =
  | { readonly state: "idle" | "working" | "done" }
  | { readonly state: "blocked"; readonly kind: "question"; readonly msg: string }
  | { readonly state: "error"; readonly msg: string };

const OSC = "\u001B]7501;";

const ST = "\u001B\\";

const MSG_MAX_BYTES = 2048;

/** Clears the terminal's OSC 7501 root record. */
export const CLEARED = `${OSC}state=clear${ST}`;

/** Precedence: an ask, then busy, then a run that ended while watched. Stopped is the user's interrupt: idle. */
export function statusOf(activity: Activity, live: RunId | undefined): ProgramStatus {
  const { question, busy, execution } = activity;

  if (question !== undefined) return { state: "blocked", kind: "question", msg: question };

  if (busy) return { state: "working" };
  const last = execution?.kind === "idle" ? execution.lastRun : null;

  if (last === null || last === undefined || last.id !== live) return { state: "idle" };

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

/** Base64 of one clean line cut to the spec's byte cap at a code point boundary. */
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
