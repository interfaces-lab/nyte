export interface Assignment {
  readonly name: string;
  readonly value: string;
}

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Reads pasted `.env` text: `KEY=value`, `export KEY=value`, quoted values that may span
 * lines, and `#` comments. Lines that aren't assignments are skipped; text with none answers
 * an empty list, so a plain paste stays a plain paste.
 */
export function parseEnv(text: string): readonly Assignment[] {
  const lines = text.split(/\r?\n/);
  const found: Assignment[] = [];

  for (let index = 0; index < lines.length; index++) {
    const match = ASSIGNMENT.exec((lines[index] ?? "").trim());

    if (match === null) continue;

    const name = match[1] ?? "";
    const raw = match[2] ?? "";
    const quote = raw[0];

    if (quote !== '"' && quote !== "'") {
      found.push({ name, value: raw.replace(/\s+#.*$/, "").trim() });
      continue;
    }

    let body = raw.slice(1);

    while (closingQuote(body, quote) === -1 && index + 1 < lines.length) {
      index++;
      body += `\n${lines[index] ?? ""}`;
    }

    const end = closingQuote(body, quote);
    const inner = end === -1 ? body : body.slice(0, end);

    found.push({ name, value: quote === '"' ? unescapeDoubleQuoted(inner) : inner });
  }

  return found;
}

function closingQuote(body: string, quote: string): number {
  for (let index = 0; index < body.length; index++) {
    if (body[index] === "\\" && quote === '"') index++;
    else if (body[index] === quote) return index;
  }

  return -1;
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_match, char: string) =>
    char === "n" ? "\n" : char === "r" ? "\r" : char === "t" ? "\t" : char,
  );
}
