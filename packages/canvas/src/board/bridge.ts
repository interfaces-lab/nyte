import { useSyncExternalStore } from "react";
import type { AppMessage, BoardMessage } from "@nyte-ai/plugin/design/board-protocol";

type LightsMessage = Extract<AppMessage, { kind: "lights" }>;

/** What the app said last about how the board looks and what is lit. */
export interface View {
  readonly scheme: "light" | "dark";
  readonly night: boolean;
  readonly lights: Omit<LightsMessage, "kind">;
}

export type Command = Extract<
  AppMessage,
  | { kind: "camera" }
  | { kind: "reveal" }
  | { kind: "applied" }
  | { kind: "refused" }
  | { kind: "lights" }
  | { kind: "leave" }
  | { kind: "enter" }
  | { kind: "wheel" }
>;

const listeners = new Set<() => void>();

const commanded = new Set<(command: Command) => void>();

const early: Command[] = [];

let view: View = {
  scheme: "light",
  night: false,
  lights: { you: null, agents: [], follow: null },
};

export function post(message: BoardMessage): void {
  window.parent.postMessage(message, "*");
}

export function setView(next: Partial<View>): void {
  view = { ...view, ...next };

  for (const listener of listeners) listener();
}

export function currentView(): View {
  return view;
}

export function useView(): View {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => view,
  );
}

export function command(message: Command): void {
  if (commanded.size === 0) early.push(message);

  for (const listener of commanded) listener(message);
}

export function onCommand(listener: (command: Command) => void): () => void {
  commanded.add(listener);

  for (const message of early.splice(0)) listener(message);

  return () => commanded.delete(listener);
}
