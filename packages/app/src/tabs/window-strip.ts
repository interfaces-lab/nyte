import type { useRouter } from "@tanstack/react-router";
import type { Strip, StripAction, TabTarget } from "./strip.ts";

type AppRouter = ReturnType<typeof useRouter>;

export interface StripSnapshot {
  readonly strip: Strip;
  readonly active: TabTarget | undefined;
}

/**
 * The URL flows into the strip (`visited` on every resolve); tab actions flow out as one
 * navigation. Nothing copies strip state back into the router, so there is no sync loop.
 */
class WindowStrip {
  /** Reads the slot's strip, or starts empty when there is none. Call before the first render. */
  start(slot: number): void {
    void slot;
    throw new Error("not implemented");
  }

  /** Subscribes to the router's resolves; returns the unsubscribe. */
  attach(router: AppRouter): () => void {
    void router;
    throw new Error("not implemented");
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    void listener;
    throw new Error("not implemented");
  };

  readonly getSnapshot = (): StripSnapshot => {
    throw new Error("not implemented");
  };

  /** Reduces, writes the slot, then navigates to the step's `go`. */
  dispatch(action: StripAction): void {
    void action;
    throw new Error("not implemented");
  }

  /** The href the window opens at: the most recent tab, or a new draft. */
  initialHref(): string {
    throw new Error("not implemented");
  }
}

export const windowStrip = new WindowStrip();
