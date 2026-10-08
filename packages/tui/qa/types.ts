import type { EmbeddedTerminalScreen, MouseEvent } from "@opentui/core";
import type { ChatCommand } from "../src/constants.ts";

export type Screen = EmbeddedTerminalScreen;

export type MouseGesture = ConstructorParameters<typeof MouseEvent>[1];

export type InputRecord = {
  before: Screen;
  action: string;
  at: number;
  matchedAt?: number;
  latencyMs?: number;
};

export type TerminalOptions = {
  binary: string;
  cwd: string;
  env: Record<string, string>;
  width: number;
  height: number;
  show?: boolean;
  args?: string[];
};

export type Terminal = {
  key(action: ChatCommand): InputRecord;
  raw(bytes: string, label: string): InputRecord;
  text(text: string): InputRecord;
  mouse(event: MouseGesture): InputRecord;
  resize(width: number, height: number): InputRecord;
  screen(): Screen;
  /** Absolute performance.now() deadline. Defaults to the latest input's timing. */
  waitForScreen(
    predicate: (screen: Screen) => boolean,
    deadline: number,
    input?: InputRecord,
  ): Promise<Screen>;
  /** Visible playback names the current step above the screen; automated runs ignore it. */
  caption(text: string): void;
  /** Resolves at once in automated runs; visible playback leaves a short gap before input. */
  pace(): Promise<void>;
  /** Resolves at once in automated runs; visible playback waits for Enter or Space. */
  waitForWatcher(): Promise<void>;
  exited: Promise<number>;
  waitForExit(deadline: number): Promise<number>;
  signal(signal: "SIGINT" | "SIGTERM" | "SIGKILL"): void;
  inputs: InputRecord[];
  chunks: { at: number; base64: string }[];
  close(): Promise<void>;
};

export type BinaryIdentity = {
  path: string;
  sha256: string;
  version: string;
  revision: string;
  opentui: string;
};

export type ScenarioContext = {
  binary: BinaryIdentity;
  /** This scenario's evidence directory. */
  cwd: string;
  open(options: Partial<Omit<TerminalOptions, "binary" | "show">>): Promise<Terminal>;
  /** Runs the teardown if the run is stopped by a signal; call the result once it ran normally. */
  defer(teardown: () => Promise<void>): () => void;
  /** A named step; a failure names the step a person was in, and --show captions it. */
  beat(name: string, run: () => Promise<void>): Promise<void>;
};

export type Scenario = {
  name: "headless" | "tui";
  /** Actions whose first visible feedback must not wait for provider or storage results. */
  localInputs?: InputRecord["action"][];
  run(context: ScenarioContext): Promise<void>;
};
