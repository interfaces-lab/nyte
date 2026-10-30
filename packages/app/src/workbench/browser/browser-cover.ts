/** How long an overlay waits for the page's still before the page hides without one. */
const STILL_WAIT_MS = 500;

export interface PageStill {
  readonly url: string;
  readonly src: string;
}

interface PageCoverInput {
  readonly capture: () => Promise<PageStill | undefined>;
  /** Puts the still in the slot and commits it before returning. */
  readonly show: (still: PageStill) => void;
  readonly drop: () => void;
  /** The page must hide: its still has painted, or the wait ran out. */
  readonly hide: () => void;
}

interface PageCover {
  readonly hidden: () => boolean;
  readonly update: (covered: boolean) => void;
  readonly dispose: () => void;
}

/**
 * Orders an overlay's arrival over the native view. The page keeps showing while its still
 * is captured, decoded and painted under it, and only then hides, or after `STILL_WAIT_MS`
 * without one so a menu is never stuck behind the page. When the overlay leaves, the page
 * shows again and the still goes once the page has had a frame to paint over it. Every cover
 * starts a new cycle, and work from an earlier cycle is dropped.
 */
export function createPageCover(input: PageCoverInput): PageCover {
  let phase: "live" | "capturing" | "hidden" = "live";
  let cycle = 0;
  let deadline: number | undefined;

  const settle = (from: number): void => {
    if (from !== cycle || phase !== "capturing") return;
    window.clearTimeout(deadline);
    phase = "hidden";
    input.hide();
  };

  const cover = (): void => {
    cycle += 1;
    const current = cycle;
    phase = "capturing";
    deadline = window.setTimeout(() => settle(current), STILL_WAIT_MS);
    void input.capture().then(async (still) => {
      if (still === undefined) {
        settle(current);

        return;
      }

      const image = new Image();
      image.src = still.src;
      await image.decode();

      if (current !== cycle) return;
      input.show(still);
      afterPaint(() => settle(current));
    });
  };

  const end = (): number => {
    cycle += 1;
    phase = "live";
    window.clearTimeout(deadline);

    return cycle;
  };

  return {
    hidden: () => phase === "hidden",
    update: (covered) => {
      if (covered === (phase !== "live")) return;

      if (covered) {
        cover();

        return;
      }

      const current = end();
      afterPaint(() => {
        if (current === cycle) input.drop();
      });
    },
    dispose: () => {
      end();
      input.drop();
    },
  };
}

/** Runs after the next frame has painted. */
function afterPaint(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}
