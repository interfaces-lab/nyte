import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { themeSource } from "../shared/ipc-inputs.ts";

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

const stateSchema = Type.Object({
  theme: themeSource,
  window: Type.Optional(windowFrame),
  windows: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  frames: Type.Optional(Type.Record(Type.String({ minLength: 1 }), windowFrame)),
});

const launchState = Compile(stateSchema);

type ThemeSource = Static<typeof themeSource>;

type Rect = Static<typeof rect>;

export type WindowFrame = Static<typeof windowFrame>;

type LaunchState = Static<typeof stateSchema>;

export interface OpeningFrame {
  readonly bounds: Partial<Rect>;
  readonly maximized: boolean;
  readonly fullscreen: boolean;
}

const INITIAL: LaunchState = { theme: "system" };

export function openingFrame(input: {
  readonly own: WindowFrame | undefined;
  readonly last: WindowFrame | undefined;
  readonly first: boolean;
  readonly onScreen: (bounds: Rect) => boolean;
}): OpeningFrame {
  const own = input.own;
  const last = input.last;

  if (own !== undefined && input.onScreen(own.bounds)) return own;

  if (last !== undefined && own === undefined && input.first && input.onScreen(last.bounds))
    return last;

  return {
    bounds: { width: last?.bounds.width ?? 1280, height: last?.bounds.height ?? 800 },
    maximized: false,
    fullscreen: false,
  };
}

export function windowsAfterClose(
  kept: readonly string[],
  closed: string,
  input: { readonly quitting: boolean; readonly remaining: number },
): readonly string[] | undefined {
  if (input.quitting || input.remaining === 0) return undefined;

  return kept.filter((windowId) => windowId !== closed);
}

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

  windows(): readonly string[] {
    return this.#state.windows ?? [];
  }

  frame(windowId: string): WindowFrame | undefined {
    return this.#state.frames?.[windowId];
  }

  setTheme(theme: ThemeSource): void {
    this.#write({ ...this.#state, theme });
  }

  setWindow(windowId: string, window: WindowFrame): void {
    this.#write({
      ...this.#state,
      window,
      frames: { ...this.#state.frames, [windowId]: window },
    });
  }

  setWindows(windows: readonly string[]): void {
    const frames = Object.fromEntries(
      Object.entries(this.#state.frames ?? {}).filter(([windowId]) => windows.includes(windowId)),
    );

    this.#write({ ...this.#state, windows: [...windows], frames });
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
