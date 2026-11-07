const STILL_WAIT_MS = 500;

export interface PageStill {
  readonly url: string;
  readonly src: string;
}

interface PageCoverInput {
  readonly capture: () => Promise<PageStill | undefined>;
  readonly show: (still: PageStill) => void;
  readonly drop: () => void;
  readonly hide: () => void;
}

interface PageCover {
  readonly hidden: () => boolean;
  readonly update: (covered: boolean) => void;
  readonly dispose: () => void;
}

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
    input
      .capture()
      .then(decode)
      .then(
        (still) => {
          if (still === undefined) {
            settle(current);

            return;
          }

          if (current !== cycle) return;
          input.show(still);
          afterPaint(() => settle(current));
        },
        () => settle(current),
      );
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

async function decode(still: PageStill | undefined): Promise<PageStill | undefined> {
  if (still === undefined) return undefined;
  const image = new Image();
  image.src = still.src;
  await image.decode();

  return still;
}

function afterPaint(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}
