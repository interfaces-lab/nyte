/**
 * The remembered answer to the browser-access gate, keyed by the folder the
 * session runs in. The choice is a standing decision about who may drive the
 * signed-in browser profile, so it outlives the session that made it: session
 * facts die with the session, which is what made the gate ask every time.
 * Stored in `~/.nyte` beside the other user-scoped preference files.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

export type BrowserAccessLevel = "full" | "read" | "off";

export function isBrowserAccessLevel(value: unknown): value is BrowserAccessLevel {
  return value === "full" || value === "read" || value === "off";
}

const rememberedType = Type.Object(
  {
    folders: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.Literal("full"), Type.Literal("read"), Type.Literal("off")]),
      ),
    ),
  },
  { additionalProperties: false },
);
const rememberedFile = Compile(rememberedType);

type RememberedAccess = Required<Static<typeof rememberedType>>;

/** What the browser tools need from the store, so a test can hand them a fake. */
export interface BrowserAccessMemory {
  read(folder: string): Promise<BrowserAccessLevel | undefined>;
  remember(folder: string, level: BrowserAccessLevel): Promise<void>;
}

/** Serializes read-modify-write so two windows cannot lose each other's answer. */
export class BrowserAccessStore implements BrowserAccessMemory {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async read(folder: string): Promise<BrowserAccessLevel | undefined> {
    return (await this.serialized(() => this.load())).folders[folder];
  }

  async remember(folder: string, level: BrowserAccessLevel): Promise<void> {
    await this.serialized(async () => {
      const current = await this.load();
      const next: RememberedAccess = { folders: { ...current.folders, [folder]: level } };
      try {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`);
      } catch {
        // A failed write costs one more prompt next session, never the answer
        // in force now. Nothing the user asked for should fail on it.
      }
    });
  }

  /** A damaged file reads as "nothing remembered", so the gate asks again. */
  private async load(): Promise<RememberedAccess> {
    try {
      const { folders = {} } = rememberedFile.Parse(JSON.parse(await readFile(this.path, "utf8")));
      return { folders };
    } catch {
      return { folders: {} };
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
