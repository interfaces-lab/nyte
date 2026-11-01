export interface OscNotice {
  /** Undefined when the program gave none, as OSC 9 never does. */
  readonly title: string | undefined;
  readonly body: string;
}

export interface TerminalNoticeScan {
  /** An unfinished sequence to put in front of the next chunk. */
  readonly carry: string;
  readonly notices: readonly OscNotice[];
}

const OPEN = "\u001b]";

const NOTIFY = "777;notify;";

/** Longer sequences, such as a clipboard copy, aren't notifications; they're skipped unread. */
const LONGEST = 4096;

/**
 * Reads the notifications in a chunk of terminal output: OSC 9 (`ESC ] 9 ; message`) and
 * OSC 777 (`ESC ] 777 ; notify ; title ; body`), each ended by BEL or ST. A sequence can split
 * across chunks, so pass back `carry` with the next one.
 */
export function scanTerminalNotices(carry: string, chunk: string): TerminalNoticeScan {
  const text = carry + chunk;
  const notices: OscNotice[] = [];
  let open = text.indexOf(OPEN);

  while (open !== -1) {
    const end = findEnd(text, open + OPEN.length);

    if (end.kind === "open") return { carry: text.slice(open), notices };

    if (end.kind === "ended") {
      const notice = readNotice(text.slice(open + OPEN.length, end.at));

      if (notice !== undefined) notices.push(notice);
    }

    open = text.indexOf(OPEN, end.next);
  }

  return { carry: text.endsWith("\u001b") ? "\u001b" : "", notices };
}

type End =
  | { readonly kind: "ended"; readonly at: number; readonly next: number }
  | { readonly kind: "dropped"; readonly next: number }
  | { readonly kind: "open" };

function findEnd(text: string, from: number): End {
  const limit = Math.min(text.length, from + LONGEST);

  for (let at = from; at < limit; at += 1) {
    const char = text[at];

    if (char === "\u0007" || char === "\u009c") return { kind: "ended", at, next: at + 1 };

    if (char !== "\u001b") continue;

    if (at + 1 === text.length) return { kind: "open" };

    return text[at + 1] === "\\"
      ? { kind: "ended", at, next: at + 2 }
      : { kind: "dropped", next: at };
  }

  return limit === text.length ? { kind: "open" } : { kind: "dropped", next: limit };
}

function readNotice(sequence: string): OscNotice | undefined {
  if (sequence.startsWith("9;")) {
    const body = sequence.slice(2).trim();

    return body === "" || /^\d+(;|$)/u.test(body) ? undefined : { title: undefined, body };
  }

  if (!sequence.startsWith(NOTIFY)) return undefined;
  const fields = sequence.slice(NOTIFY.length).split(";");
  const title = (fields[0] ?? "").trim();
  const body = fields.slice(1).join(";").trim();

  if (title === "" && body === "") return undefined;

  return { title: title === "" ? undefined : title, body };
}

/** How much of a reattached shell's earlier output has to match to find where its replay ends. */
const FINGERPRINT = 1024;

/** Past this much replay without finding the earlier output, the rest counts as new. */
const REPLAY_LIMIT = 2 * 1024 * 1024;

/**
 * Reads a shell's output chunk by chunk and returns the notifications in each. A reattached shell
 * replays output the window already showed; `history` is that output as the window last saved
 * it, and notices up to where it ends in the replay already fired, so they're skipped. If it
 * isn't found, as when the shell printed more than the replay keeps, everything past the limit
 * counts as new.
 */
export function createNoticeReader(history: string): (chunk: string) => readonly OscNotice[] {
  const fingerprint = history.slice(-FINGERPRINT);
  let carry = "";
  let replay = fingerprint === "" ? undefined : { tail: "", read: 0 };

  const scan = (chunk: string): readonly OscNotice[] => {
    const scanned = scanTerminalNotices(carry, chunk);
    carry = scanned.carry;

    return scanned.notices;
  };

  return (chunk) => {
    if (replay === undefined) return scan(chunk);
    const seen = replay.tail + chunk;
    const found = seen.indexOf(fingerprint);

    if (found === -1) {
      scan(chunk);
      replay =
        replay.read + chunk.length > REPLAY_LIMIT
          ? undefined
          : {
              tail: seen.slice(Math.max(0, seen.length - fingerprint.length + 1)),
              read: replay.read + chunk.length,
            };

      return [];
    }

    const end = found + fingerprint.length - replay.tail.length;
    replay = undefined;
    scan(chunk.slice(0, end));

    return scan(chunk.slice(end));
  };
}
