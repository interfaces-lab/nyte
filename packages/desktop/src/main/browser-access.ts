/**
 * The remembered answer to the browser-access gate, keyed by the folder the
 * session runs in. The answer is a standing decision about who may drive the
 * signed-in browser profile, so it has to outlive the session that gave it:
 * session facts die with their session, which is what made the gate ask again
 * every time. Stored in `~/.nyte` beside the other user-scoped preferences.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

const accessLevelType = Type.Union([
  Type.Literal("full"),
  Type.Literal("read"),
  Type.Literal("off"),
]);

const accessLevelCheck = Compile(accessLevelType);

export type BrowserAccessLevel = Static<typeof accessLevelType>;

export function isBrowserAccessLevel(value: unknown): value is BrowserAccessLevel {
  return accessLevelCheck.Check(value);
}

/** Absolute folder path to the level answered for it. */
const rememberedType = Type.Record(Type.String(), accessLevelType);

const rememberedFile = Compile(rememberedType);

/** Serializes read-modify-write so two sessions cannot lose each other's answer. */
export class BrowserAccessStore {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async read(folder: string): Promise<BrowserAccessLevel | undefined> {
    return (await this.serialized(() => this.load()))[folder];
  }

  async remember(folder: string, level: BrowserAccessLevel): Promise<void> {
    await this.serialized(async () => {
      const next = { ...(await this.load()), [folder]: level };

      try {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`);
      } catch {
        // A failed write costs one more prompt next session. It must not fail
        // the tool call whose answer is already in force.
      }
    });
  }

  /**
   * A damaged file reads as "nothing remembered", so the gate asks again.
   * `Partial` because indexing a folder this file has never seen answers
   * `undefined`, which the record type alone would not admit.
   */
  private async load(): Promise<Partial<Static<typeof rememberedType>>> {
    try {
      return rememberedFile.Parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return {};
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
