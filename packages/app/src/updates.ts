import type { UpdateState } from "./bridge.ts";

export function updateLabel(state: UpdateState): string {
  switch (state.kind) {
    case "idle":
      return "Check for Updates…";
    case "downloading":
      return "Downloading Update…";
    case "ready":
      return "Restart to Update…";
    case "installing":
      return "Restarting…";
    case "failed":
      return "Update Available…";
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}
