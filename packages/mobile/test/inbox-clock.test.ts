import type { AppStateStatus } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tickWhileForeground } from "../src/inbox/inbox-clock.ts";

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

/** expo-router's useFocusEffect: the effect runs on focus; its cleanup runs on blur or unmount. */
function focusInbox(appState: ReturnType<typeof fakeAppState>, ticks: number[]) {
  return tickWhileForeground({ appState, tick: () => ticks.push(Date.now()) });
}

describe("the inbox clock", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));

  afterEach(() => vi.useRealTimers());

  it("ticks every ten seconds while focused and stops while blurred but still mounted", () => {
    const appState = fakeAppState("active");
    const ticks: number[] = [];
    const blur = focusInbox(appState, ticks);
    vi.advanceTimersByTime(30_000);
    blur();
    vi.advanceTimersByTime(60_000);
    appState.move("background");
    appState.move("active");

    expect(ticks).toEqual([0, 10_000, 20_000, 30_000]);
    expect(vi.getTimerCount()).toBe(0);

    focusInbox(appState, ticks);
    vi.advanceTimersByTime(10_000);

    expect(ticks).toEqual([0, 10_000, 20_000, 30_000, 90_000, 100_000]);
  });

  it("pauses in the background and refreshes as soon as the app returns", () => {
    const appState = fakeAppState("active");
    const ticks: number[] = [];
    focusInbox(appState, ticks);
    vi.advanceTimersByTime(5_000);
    appState.move("inactive");
    appState.move("background");
    vi.advanceTimersByTime(60_000);

    expect(ticks).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);

    appState.move("active");
    vi.advanceTimersByTime(10_000);

    expect(ticks).toEqual([0, 65_000, 75_000]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("refreshes once when focused in the background and starts ticking on foreground", () => {
    const appState = fakeAppState("background");
    const ticks: number[] = [];
    focusInbox(appState, ticks);
    vi.advanceTimersByTime(30_000);
    appState.move("active");
    vi.advanceTimersByTime(10_000);

    expect(ticks).toEqual([0, 30_000, 40_000]);
  });

  it("leaves no timer or listener behind after unmount", () => {
    const appState = fakeAppState("active");
    const ticks: number[] = [];
    const unmount = focusInbox(appState, ticks);
    appState.move("background");
    appState.move("active");
    unmount();
    appState.move("background");
    appState.move("active");
    vi.advanceTimersByTime(60_000);

    expect(ticks).toEqual([0, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
