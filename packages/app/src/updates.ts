import type { UpdateState } from "./bridge.ts";

/** The one label for Check for Updates, in the Electron menu and the sidebar alike. */
export function updateLabel(state: UpdateState): string {
  switch (state.kind) {
    case "idle":
      return "Check for Updates…";
    case "downloading":
      return "Downloading Update…";
    case "ready":
    case "blocked":
      return "Restart to Update…";
    case "failed":
      return "Update Available…";
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}
