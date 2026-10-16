import type { TestRendererSetup } from "@opentui/core/testing";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { AppProvider } from "../../../src/app/context.tsx";
import type { App, Kit } from "../../../src/app/context.tsx";
import { DARK_THEME } from "../../../src/lib/theme.ts";
import { reduceDialog } from "../../../src/model/dialogs/dialog.ts";
import type { Dialog, DialogCommand, DialogInput } from "../../../src/model/dialogs/dialog.ts";
import type { Msg } from "../../../src/model/msg.ts";
import { deriveScreen } from "../../../src/model/screen.ts";
import type { State } from "../../../src/model/state.ts";
import { DialogHost } from "../../../src/ui/dialogs/dialog-host.tsx";
import { render } from "../../fixture/render.tsx";
import { buildState } from "../../fixture/state.ts";

export interface DialogHarness extends TestRendererSetup {
  readonly dispatched: Msg[];
  send(command: DialogInput): Promise<void>;
  show(dialogs: readonly Dialog[]): Promise<void>;
  frame(): string;
}

export interface DialogOptions {
  readonly width?: number;
  readonly height?: number;
  readonly state?: State;
  readonly node?: () => JSX.Element;
}

export function key(name: string): DialogCommand {
  return { kind: "key", name };
}

export function query(text: string): DialogCommand {
  return { kind: "query", text };
}

export async function renderDialog(
  dialog: Dialog,
  options: DialogOptions = {},
): Promise<DialogHarness> {
  const [stack, setStack] = createSignal<readonly Dialog[]>([dialog]);
  const base = options.state ?? buildState(null);

  const screen = createMemo(() =>
    deriveScreen({ ...base, local: { ...base.local, dialogs: stack() } }, null),
  );

  const dispatched: Msg[] = [];

  const kit: Kit = {
    theme: () => DARK_THEME,
    syntax: () => {
      throw new Error("dialogs draw no syntax");
    },
    ticker: () => () => 0,
    now: () => 0,
    report: () => undefined,
    highlight: () => null,
    diagram: () => Promise.reject(new Error("dialogs draw no diagrams")),
    blob: () => {
      throw new Error("dialogs read no blobs");
    },
    drawPart: () => null,
    attach: { composer: () => () => {}, scroll: () => () => {} },
  };

  const app: App = {
    screen,
    dispatch: (msg) => {
      dispatched.push(msg);
    },
    kit,
  };

  const node = options.node ?? (() => <DialogHost />);

  const setup = await render(() => <AppProvider app={app}>{node()}</AppProvider>, {
    width: options.width ?? 100,
    height: options.height ?? 32,
  });

  return {
    ...setup,
    dispatched,
    async send(command) {
      const top = stack().at(-1);

      if (top === undefined) return;
      const step = reduceDialog(top, command);
      const below = stack().slice(0, -1);
      const kept = step.dialog === null ? below : [...below, step.dialog];
      setStack(step.push === null ? kept : [...kept, step.push]);
      await setup.renderOnce();
    },
    async show(dialogs) {
      setStack(dialogs);
      await setup.renderOnce();
    },
    frame: () => setup.captureCharFrame(),
  };
}

export function rows(frame: string): string[] {
  return frame.split("\n").map((row) => row.trimEnd());
}
