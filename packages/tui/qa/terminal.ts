import { Buffer } from "node:buffer";
import process from "node:process";
import { realpath } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliRenderEvents,
  createCliRenderer,
  EmbeddedTerminalRenderable,
  KeyEvent,
  MouseEvent,
  PasteEvent,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { keyStrokes } from "../src/constants.ts";
import type { InputRecord, Terminal, TerminalOptions } from "./types.ts";

/** Frames arrive as DEC 2026 synchronized updates; a chunk without one is a complete update too. */
// eslint-disable-next-line no-control-regex
const SYNCHRONIZED_UPDATE = /\x1b\[\?2026([hl])/gu;

function dimensions(width: number, height: number) {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error("Terminal dimensions must be integers from 1 to 65535.");
  }
}

export async function open(options: TerminalOptions): Promise<Terminal> {
  dimensions(options.width, options.height);
  const root = process.env.NYTE_QA_ROOT;
  if (!root)
    throw new Error("Run terminal QA through qa/run.mjs to isolate HOME before Bun starts.");
  for (const directory of [options.cwd, options.env.HOME]) {
    if (!directory) throw new Error("An isolated HOME and workspace are required.");
    const path = relative(await realpath(root), await realpath(directory));
    if (path.startsWith("..") || isAbsolute(path))
      throw new Error("QA HOME and workspace must be inside NYTE_QA_ROOT.");
  }
  if (options.show && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("--show requires terminal stdin and stdout. Run it directly in a terminal.");
  }
  const config = {
    width: options.width,
    height: options.height,
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
    enableMouseMovement: true,
    targetFps: 60,
    maxFps: Infinity,
  };
  const renderer = options.show
    ? await createCliRenderer(config)
    : (await createTestRenderer(config)).renderer;
  const inputs: InputRecord[] = [];
  const chunks: Terminal["chunks"] = [];
  const pending: Uint8Array[] = [];
  const updateAtInput = new WeakMap<InputRecord, number>();
  let controlTail = "";
  let synchronizedUpdateOpen = false;
  let completedUpdates = 0;
  let pty: Bun.Terminal | undefined;
  let connected = false;
  let closed = false;
  let finalScreen: ReturnType<Terminal["screen"]> | undefined;
  const forward = (data: Uint8Array) => {
    if (closed) return;
    if (!connected || !pty) {
      pending.push(data.slice());
      return;
    }
    pty.write(data);
  };
  const terminal = new EmbeddedTerminalRenderable(renderer, {
    id: "nyte-binary",
    width: "100%",
    height: "100%",
    cols: options.width,
    rows: options.height,
    // Host selection would compete with the same mouse gesture inside Nyte.
    selectable: false,
    onData: forward,
    onTerminalResize: (cols, rows) => pty?.resize(cols, rows),
  });
  renderer.root.add(terminal);
  terminal.focus();
  let child: ReturnType<typeof Bun.spawn>;
  let exitCode: number | undefined;
  let supervisorError: Error | undefined;
  let prepared = false;
  const binaryExit = Promise.withResolvers<number>();
  const exited = binaryExit.promise;
  // A startup failure may arrive before the caller starts awaiting exited.
  void exited.catch(() => {});
  let closing: Promise<void> | undefined;
  try {
    child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--no-install",
        fileURLToPath(new URL("./supervisor.ts", import.meta.url)),
        options.binary,
        ...(options.args ?? []),
      ],
      {
        cwd: options.cwd,
        env: { ...options.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        // Bun 1.4.2 does not assign a controlling terminal when given an existing
        // Bun.Terminal. Inline creation gives the group SIGWINCH on PTY resize.
        terminal: {
          cols: options.width,
          rows: options.height,
          data(transport, data) {
            // Query replies can arrive before spawn returns.
            pty = transport;
            connected = true;
            for (const bytes of pending.splice(0)) transport.write(bytes);
            chunks.push({ at: performance.now(), base64: Buffer.from(data).toString("base64") });
            const controls = `${controlTail}${Buffer.from(data).toString("latin1")}`;
            const modes = [...controls.matchAll(SYNCHRONIZED_UPDATE)].map((match) => match[1]);
            if (modes.length === 0 && !synchronizedUpdateOpen) completedUpdates += 1;
            for (const mode of modes) {
              synchronizedUpdateOpen = mode === "h";
              if (mode === "l") completedUpdates += 1;
            }
            // Up to seven bytes of "\x1b[?2026" may still await their final h or l.
            controlTail = controls.slice(-7);
            terminal.write(data);
          },
        },
        detached: true,
        ipc(message: unknown, supervisor) {
          if (typeof message === "object" && message !== null && "kind" in message) {
            if (
              message.kind === "exited" &&
              "code" in message &&
              typeof message.code === "number" &&
              Number.isInteger(message.code) &&
              message.code >= 0 &&
              message.code <= 255 &&
              exitCode === undefined
            ) {
              exitCode = message.code;
              binaryExit.resolve(message.code);
              return;
            }
            if (message.kind === "prepared" && closing && exitCode !== undefined) {
              prepared = true;
              try {
                supervisor.send({ kind: "finish" });
              } catch (error) {
                supervisorError = error instanceof Error ? error : new Error(String(error));
                supervisor.disconnect();
              }
              return;
            }
            if (
              message.kind === "error" &&
              "message" in message &&
              typeof message.message === "string"
            ) {
              supervisorError = new Error(`QA supervisor: ${message.message}`);
            }
          }
          supervisorError ??= new Error("Invalid QA supervisor message.");
          binaryExit.reject(supervisorError);
          // Disconnect asks the still-live owner to clean up. Never signal its
          // remembered group from here, including on unexpected supervisor exit.
          supervisor.disconnect();
        },
      },
    );
    pty ??= child.terminal;
    if (pty !== undefined) {
      connected = true;
      for (const bytes of pending.splice(0)) pty.write(bytes);
    }
  } catch (error) {
    try {
      pty?.close();
    } finally {
      try {
        terminal.destroy();
      } finally {
        renderer.destroy();
      }
    }
    throw error;
  }
  const reaped = child.exited.then(() => {
    if (!prepared || child.signalCode !== "SIGKILL") {
      supervisorError ??= new Error("QA supervisor exited without completing owned-group cleanup.");
    }
    if (exitCode === undefined) {
      supervisorError ??= new Error("QA supervisor exited without the binary's exit status.");
      binaryExit.reject(supervisorError);
    }
  });
  let cleanupSignal: "SIGINT" | "SIGTERM" = "SIGTERM";
  const interrupt = () => {
    cleanupSignal = "SIGINT";
  };
  const terminate = () => {
    cleanupSignal = "SIGTERM";
  };
  // Main closes active terminals on user signals. Capture the original signal
  // before its handler runs, rather than turning every shutdown into SIGTERM.
  process.prependListener("SIGINT", interrupt);
  process.prependListener("SIGTERM", terminate);
  function record(action: string, send: () => void) {
    if (closed || closing || exitCode !== undefined)
      throw new Error("Cannot send input to an exited terminal.");
    const before = terminal.screen();
    const input: InputRecord = { action, before, at: performance.now() };
    inputs.push(input);
    updateAtInput.set(input, completedUpdates);
    send();
    return input;
  }
  function signal(name: "SIGINT" | "SIGTERM" | "SIGKILL") {
    if (supervisorError) throw supervisorError;
    child.send({ kind: "signal", signal: name });
  }
  async function waitForExit(deadline: number) {
    const timeout = Promise.withResolvers<never>();
    const timer = globalThis.setTimeout(
      () => timeout.reject(new Error("Nyte did not exit before the deadline.")),
      Math.max(0, deadline - performance.now()),
    );
    try {
      return await Promise.race([exited, timeout.promise]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    inputs,
    chunks,
    exited,
    waitForExit,
    signal: (name) => record(name, () => signal(name)),
    screen: () => finalScreen ?? terminal.screen(),
    cursor: () => (finalScreen ?? terminal.screen()).cursor,
    key(action) {
      const stroke = keyStrokes(action)[0];
      if (!stroke) throw new Error(`No binding for ${action}.`);
      return record(action, () => {
        if (
          !terminal.handleKeyPress(
            new KeyEvent({
              name: stroke.name,
              ctrl: stroke.ctrl ?? false,
              shift: stroke.shift ?? false,
              meta: false,
              super: stroke.super ?? false,
              option: stroke.meta ?? false,
              sequence: "",
              raw: "",
              number: false,
              eventType: "press",
              source: "raw",
            }),
          )
        )
          throw new Error(`Terminal could not encode ${action}.`);
      });
    },
    gesture(key) {
      return record(`gesture:${key.name}`, () => {
        if (!terminal.handleKeyPress(new KeyEvent(key)))
          throw new Error(`Terminal could not encode ${key.name}.`);
      });
    },
    raw(bytes, label) {
      return record(label, () => forward(new TextEncoder().encode(bytes)));
    },
    text(text) {
      return record("text", () => forward(new TextEncoder().encode(text)));
    },
    paste(text) {
      return record("paste", () =>
        terminal.handlePaste(new PasteEvent(new TextEncoder().encode(text))),
      );
    },
    mouse(event) {
      return record(`mouse:${event.type}`, () =>
        terminal.processMouseEvent(new MouseEvent(terminal, event)),
      );
    },
    resize(width, height) {
      dimensions(width, height);
      return record(`resize:${width}x${height}`, () => renderer.resize(width, height));
    },
    async waitForScreen(predicate, deadline, input = inputs.at(-1)) {
      if (!Number.isFinite(deadline))
        throw new Error("A finite performance.now() deadline is required.");
      if (input && predicate(input.before))
        throw new Error(
          `Expected output already existed before ${input.action}; this would not measure the action.`,
        );
      return new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          renderer.off(CliRenderEvents.FRAME, check);
        };
        const check = () => {
          try {
            const requiredUpdate = input === undefined ? 0 : (updateAtInput.get(input) ?? 0);
            if (synchronizedUpdateOpen || completedUpdates <= requiredUpdate) return;
            const screen = finalScreen ?? terminal.screen();
            if (!predicate(screen)) return;
            if (input && input.matchedAt === undefined) {
              input.matchedAt = performance.now();
              input.latencyMs = input.matchedAt - input.at;
            }
            finish();
            resolve(screen);
          } catch (error) {
            finish();
            reject(error);
          }
        };
        const timer = globalThis.setTimeout(
          () => {
            finish();
            reject(
              new Error(
                `Screen deadline exceeded${input ? ` after ${input.action}` : ""}.\n${terminal.screen().text}`,
              ),
            );
          },
          Math.max(0, deadline - performance.now()),
        );
        renderer.on(CliRenderEvents.FRAME, check);
        check();
      });
    },
    observe(listener) {
      // Checked once per emulator frame: complete updates that finished between two
      // frames are seen as the later one, so the listener sees observed frames, not
      // every complete update the child painted.
      let seen = completedUpdates;
      const check = () => {
        if (synchronizedUpdateOpen || completedUpdates <= seen) return;
        seen = completedUpdates;
        listener(finalScreen ?? terminal.screen());
      };
      renderer.on(CliRenderEvents.FRAME, check);
      return () => renderer.off(CliRenderEvents.FRAME, check);
    },
    close() {
      closing ??= (async () => {
        try {
          // Cleanup can clear the alternate screen. Keep the scenario's last observation.
          finalScreen = terminal.screen();
          try {
            if (child.exitCode === null && child.signalCode === null) {
              child.send({ kind: "cleanup", signal: cleanupSignal });
            }
          } catch (error) {
            supervisorError ??= error instanceof Error ? error : new Error(String(error));
            child.disconnect();
          }
          await reaped;
          if (supervisorError) throw supervisorError;
        } finally {
          closed = true;
          process.off("SIGINT", interrupt);
          process.off("SIGTERM", terminate);
          terminal.onData = undefined;
          try {
            pty?.close();
          } finally {
            try {
              terminal.destroy();
            } finally {
              renderer.destroy();
            }
          }
        }
      })();
      return closing;
    },
  };
}
