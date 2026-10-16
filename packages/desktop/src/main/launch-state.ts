/**
 * What main needs before the first window exists, kept across launches: the theme the renderer
 * last chose, so the window and the startup shell open in it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";

export const themeSource = Type.Union([
  Type.Literal("system"),
  Type.Literal("light"),
  Type.Literal("dark"),
]);

const stateSchema = Type.Object({ theme: themeSource });

const launchState = Compile(stateSchema);

export type ThemeSource = Static<typeof themeSource>;

type LaunchState = Static<typeof stateSchema>;

const INITIAL: LaunchState = { theme: "system" };

function readState(path: string): LaunchState {
  try {
    return launchState.Parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return INITIAL;
  }
}

/**
 * Reads once at construction and writes synchronously on change. The file is a few bytes
 * and changes only when the theme does, and it must be read before the first window.
 */
export class LaunchStateStore {
  readonly #path: string;
  #state: LaunchState;

  constructor(path: string) {
    this.#path = path;
    this.#state = readState(path);
  }

  theme(): ThemeSource {
    return this.#state.theme;
  }

  setTheme(theme: ThemeSource): void {
    this.#write({ ...this.#state, theme });
  }

  #write(next: LaunchState): void {
    if (Value.Equal(this.#state, next)) return;
    this.#state = next;

    try {
      mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      renameSync(temporary, this.#path);
    } catch (cause) {
      process.emitWarning(`The theme could not be saved: ${String(cause)}`, {
        code: "NYTE_LAUNCH_STATE",
      });
    }
  }
}
