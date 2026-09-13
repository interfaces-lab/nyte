import type { EmbeddedTerminalScreen, KeyEvent, MouseEvent } from "@opentui/core";
import type { ChatCommand } from "../src/constants.ts";

export type Screen = EmbeddedTerminalScreen;
export type Gesture = ConstructorParameters<typeof KeyEvent>[0];
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
  gesture(key: Gesture): InputRecord;
  raw(bytes: string, label: string): InputRecord;
  text(text: string): InputRecord;
  paste(text: string): InputRecord;
  mouse(event: MouseGesture): InputRecord;
  resize(width: number, height: number): InputRecord;
  screen(): Screen;
  cursor(): Screen["cursor"];
  /** Absolute performance.now() deadline. Defaults to the latest input's timing. */
  waitForScreen(
    predicate: (screen: Screen) => boolean,
    deadline: number,
    input?: InputRecord,
  ): Promise<Screen>;
  /**
   * Calls the listener with each observed frame from now on, until the returned stop is
   * called: a complete child update, as the emulator shows it at its next frame. Updates
   * that complete between two emulator frames are observed as one.
   */
  observe(listener: (screen: Screen) => void): () => void;
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
  cwd: string;
  home: string;
  env: Record<string, string>;
  show: boolean;
  open(options?: Partial<Omit<TerminalOptions, "binary" | "show">>): Promise<Terminal>;
};
export type Scenario = {
  name: string;
  covers: string[];
  /** Actions whose first visible feedback must not wait for provider or storage results. */
  localInputs?: InputRecord["action"][];
  run(context: ScenarioContext): Promise<void>;
};
