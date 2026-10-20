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

const rect = Type.Object({
  x: Type.Integer(),
  y: Type.Integer(),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
});

const windowFrame = Type.Object({
  bounds: rect,
  maximized: Type.Boolean(),
  fullscreen: Type.Boolean(),
});

const stateSchema = Type.Object({ theme: themeSource, window: Type.Optional(windowFrame) });

const launchState = Compile(stateSchema);

type ThemeSource = Static<typeof themeSource>;

type WindowFrame = Static<typeof windowFrame>;

type LaunchState = Static<typeof stateSchema>;

const INITIAL: LaunchState = { theme: "system" };

function readState(path: string): LaunchState {
  try {
    return launchState.Parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return INITIAL;
  }
}

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

  window(): WindowFrame | undefined {
    return this.#state.window;
  }

  setTheme(theme: ThemeSource): void {
    this.#write({ ...this.#state, theme });
  }

  setWindow(window: WindowFrame): void {
    this.#write({ ...this.#state, window });
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
      process.emitWarning(`The launch state could not be saved: ${String(cause)}`, {
        code: "NYTE_LAUNCH_STATE",
      });
    }
  }
}
