const ESCAPE = "\u001b";

const BELL = "\u0007";

const MAX_COLUMN = 10_000;

interface Screen {
  readonly lines: string[];
  line: string[];
  column: number;
}

function moveTo(screen: Screen, column: number): void {
  screen.column = Math.min(Math.max(0, column), MAX_COLUMN);
}

function write(screen: Screen, char: string): void {
  while (screen.line.length < screen.column) screen.line.push(" ");
  screen.line[screen.column] = char;
  moveTo(screen, screen.column + 1);
}

function control(screen: Screen, params: string, final: string): void {
  const first = Number.parseInt((params.split(";")[0] ?? "").replace(/^\?/u, ""), 10);
  const count = (fallback: number): number => (Number.isFinite(first) ? first : fallback);

  switch (final) {
    case "K": {
      const mode = count(0);

      if (mode === 2) {
        screen.line = [];
        screen.column = 0;
      } else if (mode === 1) {
        screen.line.fill(" ", 0, screen.column + 1);
      } else {
        screen.line.length = Math.min(screen.line.length, screen.column);
      }

      return;
    }

    case "G":
      moveTo(screen, count(1) - 1);

      return;
    case "C":
      moveTo(screen, screen.column + Math.max(1, count(1)));

      return;
    case "D":
      moveTo(screen, screen.column - Math.max(1, count(1)));
  }
}

function escapeEnd(screen: Screen, raw: string, start: number): number {
  const kind = raw.charAt(start + 1);

  if (kind === "[") {
    for (let index = start + 2; index < raw.length; index += 1) {
      const code = raw.charCodeAt(index);

      if (code >= 0x40 && code <= 0x7e) {
        control(screen, raw.slice(start + 2, index), raw.charAt(index));

        return index;
      }
    }

    return raw.length - 1;
  }

  if (kind === "]") {
    for (let index = start + 2; index < raw.length; index += 1) {
      if (raw.charAt(index) === BELL) return index;

      if (raw.charAt(index) === ESCAPE && raw.charAt(index + 1) === "\\") return index + 1;
    }

    return raw.length - 1;
  }

  return Math.min(kind === "(" || kind === ")" ? start + 2 : start + 1, raw.length - 1);
}

export function terminalText(raw: string): string {
  if (!raw.includes(ESCAPE) && !raw.includes("\r") && !raw.includes("\b")) return raw;

  const screen: Screen = { lines: [], line: [], column: 0 };

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);

    if (char === "\n") {
      screen.lines.push(screen.line.join(""));
      screen.line = [];
      screen.column = 0;
    } else if (char === "\r") {
      screen.column = 0;
    } else if (char === "\b") {
      moveTo(screen, screen.column - 1);
    } else if (char === ESCAPE) {
      index = escapeEnd(screen, raw, index);
    } else if (char === "\t" || char >= " ") {
      write(screen, char);
    }
  }

  screen.lines.push(screen.line.join(""));

  return screen.lines.join("\n");
}
