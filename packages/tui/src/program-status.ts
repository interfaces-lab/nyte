import { CliRenderEvents, resolveRenderLib } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { RunInfo } from "@nyte-ai/protocol";
import { singleLine } from "./format.ts";

/** What the followed session is doing right now. */
export interface Activity {
  readonly busy: boolean;
  readonly run: RunInfo | undefined;
  /** The ask in front of the user, from the followed session or one of its sub-agents. */
  readonly question: string | undefined;
}

type ProgramStatus =
  | { readonly state: "idle" | "working" | "done" }
  | { readonly state: "blocked"; readonly kind: "question"; readonly msg: string }
  | { readonly state: "error"; readonly msg: string };

const OSC = "\u001B]7501;";

const ST = "\u001B\\";

const MSG_MAX_BYTES = 2048;

/**
 * Keeps the terminal's OSC 7501 root record equal to `read()`. Samples on every
 * frame and keypress, writes only changed reports through OpenTUI's native
 * writer, and clears the record when the renderer is destroyed. A keypress
 * after a run ends marks it seen: done and error fall back to idle.
 */
export function reportProgramStatus(renderer: CliRenderer, read: () => Activity): void {
  const lib = resolveRenderLib();
  let written: string | undefined;
  let live: RunInfo["runId"] | undefined;

  const sync = (): void => {
    if (renderer.isDestroyed) return;
    const activity = read();

    if (activity.run !== undefined && !isTerminalPhase(activity.run.phase))
      live = activity.run.runId;
    const sequence = encode(statusOf(activity, live));

    if (sequence === written) return;
    written = sequence;
    lib.writeOut(renderer.rendererPtr, sequence);
  };

  const onFrame = async (): Promise<void> => {
    sync();
  };

  const onKey = (): void => {
    live = undefined;
    sync();
  };

  renderer.setFrameCallback(onFrame);
  renderer.keyInput.on("keypress", onKey);
  renderer.once(CliRenderEvents.DESTROY, () => {
    renderer.removeFrameCallback(onFrame);
    renderer.keyInput.off("keypress", onKey);
    lib.writeOut(renderer.rendererPtr, `${OSC}state=clear${ST}`);
  });
}

/** Precedence: an ask, then busy, then a run that ended while watched. Aborted is the user's interrupt: idle. */
function statusOf(activity: Activity, live: RunInfo["runId"] | undefined): ProgramStatus {
  const { question, busy, run } = activity;

  if (question !== undefined) return { state: "blocked", kind: "question", msg: question };

  if (busy) return { state: "working" };

  if (run === undefined || run.runId !== live) return { state: "idle" };

  if (run.phase.kind === "failed") return { state: "error", msg: run.phase.failure.message };

  return { state: run.phase.kind === "done" ? "done" : "idle" };
}

function encode(status: ProgramStatus): string {
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
