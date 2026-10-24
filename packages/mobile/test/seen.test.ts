import type { CommitId } from "@nyte-ai/sdk";
import type { AppStateStatus } from "react-native";
import { asId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { seeWhileForeground } from "../src/chat/seen.ts";

function fakeAppState(initial: AppStateStatus) {
  const listeners = new Set<(state: AppStateStatus) => void>();

  const appState = {
    currentState: initial,
    addEventListener(_type: "change", listener: (state: AppStateStatus) => void) {
      listeners.add(listener);

      return { remove: () => listeners.delete(listener) };
    },
    move(state: AppStateStatus) {
      appState.currentState = state;

      for (const listener of listeners) listener(state);
    },
  };

  return appState;
}

function focusChat(appState: ReturnType<typeof fakeAppState>, tip: string | undefined) {
  const seen: CommitId[] = [];

  const stop = seeWhileForeground({
    appState,
    tip: tip === undefined ? undefined : asId(tip),
    see: async (commit) => {
      seen.push(commit);
    },
  });

  return { seen, stop };
}

describe("marking the chat read", () => {
  it("marks the drawn tip at once while the app is active, and again on each return", () => {
    const appState = fakeAppState("active");
    const chat = focusChat(appState, "c1");

    expect(chat.seen).toEqual(["c1"]);

    appState.move("inactive");
    appState.move("background");
    appState.move("active");

    expect(chat.seen).toEqual(["c1", "c1"]);
  });

  it("marks nothing in the background until the app is active", () => {
    const appState = fakeAppState("background");
    const chat = focusChat(appState, "c1");

    expect(chat.seen).toEqual([]);

    appState.move("active");

    expect(chat.seen).toEqual(["c1"]);
  });

  it("marks nothing once the screen blurs or the tip moves on", () => {
    const appState = fakeAppState("active");
    const first = focusChat(appState, "c1");
    first.stop();
    const second = focusChat(appState, "c2");
    second.stop();
    appState.move("background");
    appState.move("active");

    expect(first.seen).toEqual(["c1"]);
    expect(second.seen).toEqual(["c2"]);
  });

  it("marks nothing before the chat has a commit", () => {
    const appState = fakeAppState("background");
    const chat = focusChat(appState, undefined);
    appState.move("active");

    expect(chat.seen).toEqual([]);
  });
});
