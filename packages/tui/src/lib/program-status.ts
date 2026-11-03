import type { Execution, RunId } from "@nyte-ai/sdk";
import { singleLine } from "./format.ts";

export type ProgramState =
  | { readonly state: "idle" | "working" | "done" | "error"; readonly msg: string }
  | {
      readonly state: "blocked";
      readonly kind: "permission" | "question" | "auth";
      readonly msg: string;
    };

export type ProgramStatus = ProgramState & { readonly title: string | null };

const OSC = "\u001B]7501;";

const ST = "\u001B\\";

const TITLE_MAX_BYTES = 192;

const MSG_MAX_BYTES = 2048;

export const CLEARED = `${OSC}state=clear${ST}`;

export function readProgramStatus(
  execution: Execution | undefined,
  watched: RunId | null,
): ProgramState {
  if (execution !== undefined && execution.kind !== "idle")
    return { state: "working", msg: "Working" };
  const last = execution?.lastRun ?? null;

  if (last?.end.kind === "failed") return { state: "error", msg: last.end.failure.message };

  if (last !== null && last.id === watched && last.end.kind === "completed")
    return { state: "done", msg: "Finished" };

  return { state: "idle", msg: "Ready" };
}

export function encode(status: ProgramStatus): string {
  const title = status.title === null ? undefined : base64Within(status.title, TITLE_MAX_BYTES);
  const msg = base64Within(status.msg, MSG_MAX_BYTES);

  const pairs = [
    `state=${status.state}`,
    ...(status.state === "blocked" ? [`kind=${status.kind}`] : []),
    "app=nyte",
    ...(title === undefined ? [] : [`title=${title}`]),
    ...(msg === undefined ? [] : [`msg=${msg}`]),
  ];

  return `${OSC}${pairs.join(":")}${ST}`;
}

function base64Within(text: string, maxBytes: number): string | undefined {
  const clean = singleLine(text);

  if (clean === "") return undefined;

  if (Buffer.byteLength(clean) <= maxBytes) return Buffer.from(clean).toString("base64");
  const budget = maxBytes - Buffer.byteLength("…");
  let kept = "";
  let bytes = 0;

  for (const char of clean) {
    bytes += Buffer.byteLength(char);

    if (bytes > budget) break;
    kept += char;
  }

  return Buffer.from(`${kept}…`).toString("base64");
}
