import "../../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Connection, Job, OutputFrame } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { receiveChatExcerpts } from "../conversation/add-to-chat.ts";
import { ComposerEditor } from "../conversation/composer-editor.tsx";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { nyte } from "../nyte.ts";
import { queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { TerminalPanel } from "./terminal-panel.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
}

async function until(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message);
    await paint();
  }
}

/** A shell job whose output the test prints. */
function shellJob() {
  const frames: OutputFrame[] = [];
  let wake: (() => void) | null = null;

  const job: Job = {
    id: asId<"job">("job-shell"),
    key: asId<"job-key">("shell"),
    write: async () => undefined,
    output: async function* () {
      for (;;) {
        const frame = frames.shift();

        if (frame === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        yield frame;
      }
    },
    resize: async () => ({ kind: "resized" }),
    idle: async () => true,
    stop: async () => ({
      kind: "settled",
      outcome: { kind: "exited", code: null, reason: "terminated" },
    }),
    settled: async () => ({ kind: "exited", code: 0, reason: "exited" }),
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return {
    job,
    print: (text: string) => {
      frames.push({ kind: "bytes", data: new TextEncoder().encode(text) });
      wake?.();
    },
  };
}

/** The vertical centres of the grid rows that hold ink, top to bottom. */
function inkedRows(canvas: HTMLCanvasElement): readonly number[] {
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("The terminal draws without a 2D canvas");
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const background = [data[0], data[1], data[2]];
  const bands: { start: number; end: number }[] = [];

  for (let y = 0; y < height; y += 1) {
    let inked = false;

    for (let x = 0; x < width && !inked; x += 1) {
      const at = (y * width + x) * 4;
      inked = [0, 1, 2].some(
        (channel) => Math.abs((data[at + channel] ?? 0) - (background[channel] ?? 0)) > 60,
      );
    }

    const last = bands.at(-1);

    if (!inked) continue;

    if (last !== undefined && last.end >= y - 2) last.end = y;
    else bands.push({ start: y, end: y });
  }

  const scale = canvas.height / canvas.getBoundingClientRect().height;

  return bands.map((band) => (band.start + band.end) / 2 / scale);
}

function mouse(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
  );
}

export async function run(): Promise<string> {
  const id = "add-to-chat-terminal";
  const shell = shellJob();
  const scripted = scriptedConnection({}).connection;
  const workspace = asId<"workspace">("terminal-workspace");

  const connection: Connection = {
    ...scripted,
    workspace: (target) => ({
      ...scripted.workspace(target),
      jobs: {
        start: async () => shell.job,
        recover: async () => shell.job,
        list: async () => [],
        watch: async function* () {},
      },
      job: () => shell.job,
    }),
  };

  window.localStorage.setItem(
    `nyte.terminal.${id}`,
    JSON.stringify({ workspace, key: "shell", printed: "" }),
  );
  installConnection(connection);

  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;height:480px;width:720px";
  document.body.append(container);
  const root = createRoot(container);
  const composer = createRef<ComposerEditorHandle>();

  const stop = receiveChatExcerpts(({ reference }) => composer.current?.insertReference(reference));

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <div style={{ height: 96 }}>
          <ComposerEditor
            ref={composer}
            document={{ text: "", selectionStart: 0, selectionEnd: 0 }}
            files={[]}
            disabled={false}
            placeholder="Message"
            onKeyDown={() => {}}
            onDocumentChange={() => {}}
          />
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <TerminalPanel tabId={id} workspacePath={null} visible />
        </div>
      </QueryClientProvider>,
    ),
  );

  const input = (): HTMLTextAreaElement | null =>
    container.querySelector('textarea[aria-label="Terminal input"]');

  const enter = (): void => {
    input()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  try {
    await until(() => input() !== null, "The shell's input never mounted");
    shell.print("$ echo one");
    await paint();
    enter();
    shell.print("\r\none\r\n$ pnpm test");
    await paint();
    enter();
    shell.print("\r\nFAIL a.test.ts\r\n$ ");

    const canvas = container.querySelector("canvas");

    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("The terminal has no canvas");
    await until(() => inkedRows(canvas).length >= 5, "The shell's output never drew");
    const box = canvas.getBoundingClientRect();
    const row = box.top + (inkedRows(canvas)[3] ?? 0);
    mouse(canvas, "mousedown", box.left + 1, row);
    mouse(canvas, "mousemove", box.left + 200, row);
    mouse(document, "mouseup", box.left + 200, row);
    await paint();

    const action = (): HTMLButtonElement | null =>
      container.querySelector("button[aria-keyshortcuts]");

    check(action()?.textContent === "Add to Chat", "A selection offers Add to Chat");

    const chord = new KeyboardEvent("keydown", {
      code: "KeyL",
      key: "L",
      shiftKey: true,
      metaKey: nyte.platform === "darwin",
      ctrlKey: nyte.platform !== "darwin",
      bubbles: true,
      cancelable: true,
    });

    input()?.dispatchEvent(chord);
    await paint();

    const part = composer.current?.read().parts.find((candidate) => candidate.kind === "excerpt");
    check(
      JSON.stringify(part) ===
        JSON.stringify({
          kind: "excerpt",
          source: { kind: "terminal", command: "$ pnpm test" },
          text: "FAIL a.test.ts",
        }),
      `The chord adds the selection under the command it followed, not ${JSON.stringify(part)}`,
    );
    const chip = container.querySelector('[data-composer-chip="excerpt"]');
    check(chip?.textContent === "$ pnpm test", `The chip names the command: ${chip?.textContent}`);
    check(action() === null, "Adding clears the selection and its action");

    return "passed";
  } finally {
    stop();
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
