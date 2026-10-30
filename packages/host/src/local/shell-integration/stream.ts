/** What a terminal's shell last reported through Nyte's authenticated OSC 633 extension: `inactive` until a marker carrying the terminal's nonce arrives (and again after `X`), `prompt` with the number of jobs in the shell's job table, `running` while a submitted command line runs. */
export type ShellState =
  | { readonly kind: "inactive" }
  | { readonly kind: "prompt"; readonly jobs: number }
  | { readonly kind: "running" };

export type ShellStream = {
  /** The text with every complete OSC 633 envelope removed, holding back a sequence split across chunks until it completes. */
  read(text: string): string;
  /** The held-back text at the end of output, without a partial OSC 633 envelope. */
  end(): string;
  state(): ShellState;
};

const ESC = "\x1b";

const BEL = "\x07";

const CAN = "\x18";

const SUB = "\x1a";

/** A 633 payload longer than this is discarded through its terminator. */
const MARKER_LIMIT = 16 * 1024;

const MARKER = /^Nyte;1;([0-9a-f]{64});(?:A;(0|[1-9][0-9]{0,5})|(C)|X)$/;

type Mode =
  | { readonly kind: "text" }
  | { readonly kind: "escape" }
  | { readonly kind: "number"; readonly digits: string }
  | { readonly kind: "marker"; readonly payload: string; readonly escaped: boolean }
  | { readonly kind: "overflow"; readonly escaped: boolean }
  | { readonly kind: "string"; readonly bell: boolean; readonly escaped: boolean };

const TEXT: Mode = { kind: "text" };

/** Splits a terminal's output into what it shows and what its shell reports. Only `ESC ] 633 ; Nyte ; 1 ; <nonce> ; A;<jobs> | C | X` terminated by BEL or ST changes the state, and only with `nonce` (none when null); every other OSC 633 is removed too, and other OSC, DCS, SOS, PM and APC strings pass through without being searched for markers. */
export function createShellStream(nonce: string | null): ShellStream {
  let state: ShellState = { kind: "inactive" };
  let mode: Mode = TEXT;

  const report = (payload: string): void => {
    const match = MARKER.exec(payload);

    if (match === null || nonce === null || match[1] !== nonce) return;
    const jobs = match[2];

    if (jobs !== undefined) state = { kind: "prompt", jobs: Number(jobs) };
    else state = match[3] === undefined ? { kind: "inactive" } : { kind: "running" };
  };

  const read = (text: string): string => {
    let shown = "";
    let index = 0;

    while (index < text.length) {
      const char = text.charAt(index);

      switch (mode.kind) {
        case "text": {
          const next = text.indexOf(ESC, index);
          shown += text.slice(index, next === -1 ? text.length : next);
          index = next === -1 ? text.length : next + 1;

          if (next !== -1) mode = { kind: "escape" };

          continue;
        }

        case "escape":
          index += 1;

          if (char === "]") mode = { kind: "number", digits: "" };
          else if (char === "P" || char === "X" || char === "^" || char === "_") {
            shown += ESC + char;
            mode = { kind: "string", bell: false, escaped: false };
          } else if (char === ESC) shown += ESC;
          else {
            shown += ESC + char;
            mode = TEXT;
          }

          continue;
        case "number":
          if (mode.digits.length < 3 && char === "633".charAt(mode.digits.length)) {
            mode = { kind: "number", digits: mode.digits + char };
            index += 1;

            continue;
          }

          if (mode.digits === "633" && (char === ";" || char === BEL || char === ESC)) {
            index += 1;

            if (char === BEL) {
              report("");
              mode = TEXT;
            } else mode = { kind: "marker", payload: "", escaped: char === ESC };

            continue;
          }

          if (mode.digits === "633" && (char === CAN || char === SUB)) {
            mode = TEXT;

            continue;
          }

          shown += `${ESC}]${mode.digits}`;
          mode = { kind: "string", bell: true, escaped: false };

          continue;
        case "marker":
        case "overflow": {
          if (mode.escaped) {
            if (char === "\\") {
              index += 1;

              if (mode.kind === "marker") report(mode.payload);
              mode = TEXT;
            } else mode = { kind: "escape" };

            continue;
          }

          const end = findStop(text, index);

          const payload = mode.kind === "marker" ? mode.payload + text.slice(index, end) : "";

          mode =
            mode.kind === "overflow" || payload.length > MARKER_LIMIT
              ? { kind: "overflow", escaped: false }
              : { kind: "marker", payload, escaped: false };
          index = end;

          if (end === text.length) continue;
          const terminator = text.charAt(end);
          index += 1;

          if (terminator === ESC) mode = { ...mode, escaped: true };
          else {
            if (terminator === BEL && mode.kind === "marker") report(mode.payload);

            if (terminator === CAN || terminator === SUB) shown += terminator;
            mode = TEXT;
          }

          continue;
        }

        case "string": {
          if (mode.escaped) {
            if (char === "\\") {
              shown += `${ESC}\\`;
              index += 1;
              mode = TEXT;
            } else mode = { kind: "escape" };

            continue;
          }

          const end = findStop(text, index);
          shown += text.slice(index, end);
          index = end;

          if (end === text.length) continue;
          const terminator = text.charAt(end);
          index += 1;

          if (terminator === ESC) mode = { ...mode, escaped: true };
          else {
            shown += terminator;

            if (terminator !== BEL || mode.bell) mode = TEXT;
          }
        }
      }
    }

    return shown;
  };

  return {
    read,
    end() {
      const held =
        mode.kind === "escape" || (mode.kind === "string" && mode.escaped)
          ? ESC
          : mode.kind === "number"
            ? `${ESC}]${mode.digits}`
            : "";

      mode = TEXT;

      return held;
    },
    state: () => state,
  };
}

/** The index of the first BEL, CAN, SUB or ESC in `text` from `from`, which ends or interrupts a terminal string; the length when there is none. */
function findStop(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text.charAt(index);

    if (char === BEL || char === CAN || char === SUB || char === ESC) return index;
  }

  return text.length;
}
