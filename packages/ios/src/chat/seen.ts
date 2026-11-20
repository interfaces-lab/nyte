import type { AppState, AppStateStatus } from "react-native";
import type { CommitId } from "@nyte-ai/sdk";

type ForegroundSource = Pick<typeof AppState, "currentState"> & {
  addEventListener(type: "change", listener: (state: AppStateStatus) => void): { remove(): void };
};

export function seeWhileForeground({
  appState,
  tip,
  see,
}: {
  appState: ForegroundSource;
  tip: CommitId | undefined;
  see: (commit: CommitId) => Promise<void>;
}): () => void {
  if (tip === undefined) return () => undefined;

  const mark = () => {
    void see(tip).catch(() => undefined);
  };

  if (appState.currentState === "active") mark();

  const subscription = appState.addEventListener("change", (state) => {
    if (state === "active") mark();
  });

  return () => subscription.remove();
}
