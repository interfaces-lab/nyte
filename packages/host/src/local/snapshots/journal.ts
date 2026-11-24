import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { readErrorCode } from "../../fs-errors.ts";

const ContentType = Type.Union([Type.String(), Type.Null()]);

const ChangeType = Type.Tuple([Type.String(), ContentType, ContentType]);

const LineType = Type.Object({ id: Type.String(), changes: Type.Array(ChangeType) });

const lineValidator = Compile(LineType);

type Content = Static<typeof ContentType>;

export type Change = Static<typeof ChangeType>;

type Line = Static<typeof LineType>;

export type Range = {
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
};

export type Journal = {
  started(): Promise<boolean>;
  head(): Promise<string>;
  append(changes: readonly Change[]): Promise<string>;
  range(from: string | null, to: string): Promise<Range>;
};

export const ORIGIN = "origin";

export function openJournal(path: string): Journal {
  const lines: Line[] = [];
  const positions = new Map<string, number>([[ORIGIN, -1]]);
  let offset = 0;
  let rest = "";
  let begun: Promise<void> | undefined;

  const begin = (): Promise<void> =>
    (begun ??= mkdir(dirname(path), { recursive: true }).then(() => appendFile(path, "")));

  const refresh = async (): Promise<"missing" | "read"> => {
    const handle = await open(path, "r").catch((error: unknown) => {
      if (readErrorCode(error) === "ENOENT") return null;
      throw error;
    });

    if (handle === null) return "missing";

    try {
      const { size } = await handle.stat();

      if (size <= offset) return "read";
      const bytes = new Uint8Array(size - offset);
      await handle.read(bytes, 0, bytes.length, offset);
      offset = size;
      const text = rest + new TextDecoder().decode(bytes);
      const pieces = text.split("\n");
      rest = pieces.pop() ?? "";

      for (const piece of pieces) {
        const line = readLine(piece);

        if (line === null || positions.has(line.id)) continue;
        positions.set(line.id, lines.length);
        lines.push(line);
      }

      return "read";
    } finally {
      await handle.close();
    }
  };

  const position = (id: string): number => {
    const found = positions.get(id);

    if (found === undefined) throw new SdkError("unknown", `No snapshot journal:${id} is stored.`);

    return found;
  };

  return {
    async started() {
      return (await refresh()) !== "missing";
    },
    async head() {
      await begin();
      await refresh();

      return lines.at(-1)?.id ?? ORIGIN;
    },
    async append(changes) {
      const id = randomUUID();
      await begin();
      await appendFile(path, `\n${JSON.stringify({ id, changes })}\n`);
      await refresh();

      return id;
    },
    async range(from, to) {
      await refresh();
      const start = from === null ? -1 : position(from);
      const end = position(to);
      const first = new Map<string, Content>();
      const last = new Map<string, Content>();

      for (const line of lines.slice(Math.min(start, end) + 1, Math.max(start, end) + 1))
        for (const [changed, was, now] of line.changes) {
          if (!first.has(changed)) first.set(changed, was);
          last.set(changed, now);
        }

      const [before, after] = start <= end ? [first, last] : [last, first];

      return { before: present(before), after: present(after) };
    },
  };
}

function present(contents: ReadonlyMap<string, Content>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...contents].flatMap(([path, hash]) => (hash === null ? [] : [[path, hash]])),
  );
}

function readLine(text: string): Line | null {
  if (text === "") return null;

  try {
    const value: unknown = JSON.parse(text);

    return lineValidator.Check(value) ? value : null;
  } catch {
    return null;
  }
}
