import { readNotice } from "./terminal-notifications.ts";
import type { OscNotice } from "./terminal-notifications.ts";
import { createProgramRecords } from "./terminal-program-status.ts";

/** The saved tail identifies the end of replay without keeping the whole scrollback. */
const FINGERPRINT = 1024;

/** Past this much replay without finding the saved tail, the rest counts as new. */
const REPLAY_LIMIT = 2 * 1024 * 1024;

/** Longer OSCs, such as a clipboard copy, are neither notices nor status reports; they're skipped unread. */
const LONGEST = 4096;

const ESC = "\u001b";

type Sequence = { readonly kind: "osc"; readonly body: string } | { readonly kind: "reset" };

type End =
  | { readonly kind: "ended"; readonly at: number; readonly next: number }
  | { readonly kind: "dropped"; readonly next: number }
  | { readonly kind: "open" };

/**
 * Reads one PTY's output for notifications and program status. A reattached shell replays output
 * the window already showed (`history`): its status is restored, but it never notifies or answers
 * the program again. A job is read-only, so it only reports status. After a gap in the output,
 * whatever it reported is unknown, so the records reset.
 */
export function createTerminalReader(
  source: { readonly kind: "shell"; readonly history: string } | { readonly kind: "job" },
) {
  const program = createProgramRecords();
  const fingerprint = source.kind === "shell" ? source.history.slice(-FINGERPRINT) : "";
  let carry = "";
  let replay = fingerprint === "" ? undefined : { tail: "", read: 0 };

  const scan = (chunk: string, live: boolean) => {
    const scanned = scanSequences(carry, chunk);
    carry = scanned.carry;
    let reply = "";

    for (const sequence of scanned.sequences) {
      if (sequence.kind === "reset") program.reset();
      else reply += program.report(sequence.body);
    }

    const interactive = live && source.kind === "shell";

    return {
      records: program.records(),
      reply: interactive ? reply : "",
      notices: interactive
        ? scanned.sequences.flatMap((sequence): OscNotice[] => {
            const notice = sequence.kind === "osc" ? readNotice(sequence.body) : undefined;

            return notice === undefined ? [] : [notice];
          })
        : [],
    };
  };

  return {
    read(chunk: string) {
      if (replay === undefined) return scan(chunk, true);
      const seen = replay.tail + chunk;
      const found = seen.indexOf(fingerprint);

      if (found === -1) {
        replay =
          replay.read + chunk.length > REPLAY_LIMIT
            ? undefined
            : {
                tail: seen.slice(Math.max(0, seen.length - fingerprint.length + 1)),
                read: replay.read + chunk.length,
              };

        return scan(chunk, false);
      }

      const end = found + fingerprint.length - replay.tail.length;
      replay = undefined;
      scan(chunk.slice(0, end), false);

      return scan(chunk.slice(end), true);
    },
    close: () => program.expire(),
    acknowledge: () => program.acknowledge(),
    gap() {
      carry = "";

      if (replay !== undefined) replay = { tail: "", read: replay.read };

      return program.reset();
    },
  };
}

/**
 * The OSCs (ended by BEL or ST) and full resets (`ESC c`) in a chunk, in order. A sequence can
 * split across chunks, so pass back `carry` with the next one.
 */
function scanSequences(carry: string, chunk: string) {
  const text = carry + chunk;
  const sequences: Sequence[] = [];
  let escape = text.indexOf(ESC);

  while (escape !== -1) {
    const next = text[escape + 1];

    if (next === undefined) return { carry: ESC, sequences };

    if (next !== "]") {
      if (next === "c") sequences.push({ kind: "reset" });
      escape = text.indexOf(ESC, escape + 1);

      continue;
    }

    const end = findEnd(text, escape + 2);

    if (end.kind === "open") return { carry: text.slice(escape), sequences };

    if (end.kind === "ended") sequences.push({ kind: "osc", body: text.slice(escape + 2, end.at) });
    escape = text.indexOf(ESC, end.next);
  }

  return { carry: "", sequences };
}

/** An ESC other than ST's aborts the sequence and may start the next one. */
function findEnd(text: string, from: number): End {
  const limit = Math.min(text.length, from + LONGEST);

  for (let at = from; at < limit; at += 1) {
    const char = text[at];

    if (char === "\u0007" || char === "\u009c") return { kind: "ended", at, next: at + 1 };

    if (char !== ESC) continue;

    if (at + 1 === text.length) return { kind: "open" };

    return text[at + 1] === "\\"
      ? { kind: "ended", at, next: at + 2 }
      : { kind: "dropped", next: at };
  }

  return limit === text.length ? { kind: "open" } : { kind: "dropped", next: limit };
}
