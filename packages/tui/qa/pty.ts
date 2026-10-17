import { Buffer } from "node:buffer";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import { EmbeddedTerminalRenderable, KeyEvent } from "@opentui/core";
import type { EmbeddedTerminalScreen } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { keyStrokes } from "../src/lib/constants.ts";
import type { ChatCommand } from "../src/lib/constants.ts";
import type { Ending } from "../src/lifecycle.ts";

const WAIT_MS = 15_000;

/** The compiled binary on a real PTY, its screen parsed by OpenTUI's terminal emulator. */
export interface Pty extends AsyncDisposable {
  /** `performance.now()` just after the binary was spawned. */
  readonly spawnedAt: number;
  screen(): EmbeddedTerminalScreen;
  /** Sends the first key bound to `command`, encoded for the modes the binary negotiated. */
  press(command: ChatCommand): void;
  type(text: string): void;
  waitFor(predicate: (screen: EmbeddedTerminalScreen) => boolean): Promise<EmbeddedTerminalScreen>;
  signal(name: Ending): void;
  /** Closes the PTY's master, as a terminal app does when its tab closes: the binary's input ends and its writes fail. */
  hangUp(): void;
  /** The exit status; Bun reports a signal as 128 plus its number, as a shell does. */
  exited(): Promise<number>;
  /** Everything the binary wrote, without escape sequences; the exit text is at its end. */
  output(): string;
}

export async function openPty(options: {
  readonly binary: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly width?: number;
  readonly height?: number;
  /** Written to the PTY right after spawn, before the binary has read anything. */
  readonly typed?: string;
}): Promise<Pty> {
  const width = options.width ?? 100;
  const height = options.height ?? 32;
  const setup = await createTestRenderer({ width, height });
  const written: Buffer[] = [];
  let pty: Bun.Terminal | undefined;

  const emulator = new EmbeddedTerminalRenderable(setup.renderer, {
    width,
    height,
    cols: width,
    rows: height,
    onData: (data) => pty?.write(data),
  });

  setup.renderer.root.add(emulator);

  const child = Bun.spawn([options.binary, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: { ...options.env },
    detached: true,
    terminal: {
      cols: width,
      rows: height,
      data(_terminal, data) {
        written.push(Buffer.from(data));
        emulator.write(data);
      },
    },
  });

  const spawnedAt = performance.now();
  pty = child.terminal;

  if (options.typed !== undefined) pty?.write(options.typed);

  const waitFor = async (
    predicate: (screen: EmbeddedTerminalScreen) => boolean,
  ): Promise<EmbeddedTerminalScreen> => {
    const deadline = performance.now() + WAIT_MS;

    while (performance.now() < deadline) {
      const screen = emulator.screen();

      if (predicate(screen)) return screen;
      await Bun.sleep(10);
    }

    throw new Error(`The screen never matched. Last screen:\n${emulator.screen().text}`);
  };

  const close = async (): Promise<void> => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
    }

    await child.exited;
    pty?.close();
    await setup.dispose();
  };

  return {
    spawnedAt,
    screen: () => emulator.screen(),
    press(command) {
      const [stroke] = keyStrokes(command);

      if (stroke === undefined) throw new Error(`No key is bound to ${command}.`);
      pty?.write(
        emulator.encodeKey(
          new KeyEvent({
            name: stroke.name,
            ctrl: stroke.ctrl ?? false,
            shift: stroke.shift ?? false,
            meta: false,
            option: stroke.meta ?? false,
            super: stroke.super ?? false,
            sequence: "",
            raw: "",
            number: false,
            eventType: "press",
            source: "raw",
          }),
        ),
      );
    },
    type: (text) => pty?.write(text),
    waitFor,
    signal: (name) => process.kill(child.pid, name),
    hangUp: () => pty?.close(),
    exited: () => child.exited,
    output: () =>
      stripVTControlCharacters(Buffer.concat(written).toString("utf8")).replaceAll("\r", ""),
    [Symbol.asyncDispose]: close,
  };
}
