export type ShellState =
  | { readonly kind: "inactive" }
  | { readonly kind: "prompt"; readonly jobs: number }
  | { readonly kind: "running" };

export type ShellStream = {
  read(text: string): string;
  end(): string;
  state(): ShellState;
};

const ESC = "\x1b";

const BEL = "\x07";

const CAN = "\x18";

const SUB = "\x1a";

const MARKER_LIMIT = 16 * 1024;

const MARKER = /^Nyte;1;([0-9a-f]{64});(?:A;(0|[1-9][0-9]{0,5})|(C)|X)$/;

const STOP = new RegExp(`[${BEL}${CAN}${SUB}${ESC}]`, "g");

type Mode =
  | { readonly kind: "text" }
  | { readonly kind: "escape" }
  | { readonly kind: "number"; readonly digits: string }
  | {
      readonly kind: "string";
      readonly bell: boolean;
      readonly escaped: boolean;
      readonly payload: string | null | undefined;
    };

const TEXT: Mode = { kind: "text" };

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
          else if (char === ESC) shown += ESC;
          else {
            shown += ESC + char;
            mode = "PX^_".includes(char)
              ? { kind: "string", bell: false, escaped: false, payload: undefined }
              : TEXT;
          }

          continue;
        case "number":
          if ("633".startsWith(mode.digits + char)) {
            mode = { kind: "number", digits: mode.digits + char };
            index += 1;
          } else if (mode.digits === "633" && `;${BEL}${CAN}${SUB}${ESC}`.includes(char)) {
            if (char === ";") index += 1;
            mode = { kind: "string", bell: true, escaped: false, payload: "" };
          } else {
            shown += `${ESC}]${mode.digits}`;
            mode = { kind: "string", bell: true, escaped: false, payload: undefined };
          }

          continue;
        case "string": {
          if (mode.escaped) {
            if (char === "\\") {
              index += 1;

              if (mode.payload === undefined) shown += `${ESC}\\`;
              else if (mode.payload !== null) report(mode.payload);
              mode = TEXT;
            } else mode = { kind: "escape" };

            continue;
          }

          STOP.lastIndex = index;
          const end = STOP.exec(text)?.index ?? text.length;
          const part = text.slice(index, end);

          const payload =
            mode.payload === undefined || mode.payload === null
              ? mode.payload
              : mode.payload + part;

          if (payload === undefined) shown += part;
          mode = { ...mode, payload: (payload?.length ?? 0) > MARKER_LIMIT ? null : payload };
          index = end;

          if (end === text.length) continue;
          const terminator = text.charAt(end);
          index += 1;

          if (terminator === ESC) {
            mode = { ...mode, escaped: true };

            continue;
          }

          if (mode.payload === undefined || terminator !== BEL) shown += terminator;
          else if (mode.payload !== null) report(mode.payload);

          if (terminator !== BEL || mode.bell) mode = TEXT;
        }
      }
    }

    return shown;
  };

  return {
    read,
    end() {
      const held =
        mode.kind === "escape" ||
        (mode.kind === "string" && mode.escaped && mode.payload === undefined)
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
