import type { AppState, AppStateStatus } from "react-native";

const TICK_MS = 10_000;

type ForegroundSource = Pick<typeof AppState, "currentState"> & {
  addEventListener(type: "change", listener: (state: AppStateStatus) => void): { remove(): void };
};

/**
 * Drives the inbox clock for one focus of the screen: ticks now, then every ten seconds while the app is
 * in the foreground, and again on each return to it. The returned stop is the focus effect's cleanup.
 */
export function tickWhileForeground({
  appState,
  tick,
}: {
  appState: ForegroundSource;
  tick: () => void;
}): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const pause = () => {
    clearInterval(timer);
    timer = undefined;
  };

  const resume = () => {
    tick();
    timer ??= setInterval(tick, TICK_MS);
  };

  if (appState.currentState === "active") resume();
  else tick();

  const subscription = appState.addEventListener("change", (state) => {
    if (state === "active") resume();
    else pause();
  });

  return () => {
    pause();
    subscription.remove();
  };
}
