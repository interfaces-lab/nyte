import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Spinner } from "@nyte-ai/ui/spinner";
import "../src/theme/tokens.stylex.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  flushSync(() => createRoot(host).render(<Spinner />));
  const spinner = host.firstElementChild;

  if (!(spinner instanceof HTMLElement)) throw new Error("Missing spinner");

  return spinner;
}

function shownFrame(spinner: HTMLElement): number {
  const strip = spinner.firstElementChild;

  if (strip === null) throw new Error("Missing frames");
  const clip = spinner.getBoundingClientRect();

  return Math.round((clip.left - strip.getBoundingClientRect().left) / clip.width);
}

function phase(spinner: HTMLElement): number {
  const [animation] = spinner.getAnimations({ subtree: true });
  const delay = animation.effect?.getTiming().delay ?? 0;

  return (((Number(animation.currentTime) - delay) % 1600) + 1600) % 1600;
}

export async function run(): Promise<string> {
  const first = mount();

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await nextFrame();
    check(document.getAnimations().length === 0, "A still spinner runs no animation");
    check(shownFrame(first) === 6, `A still spinner shows frame 6, not ${shownFrame(first)}`);

    return "passed";
  }

  await wait(370);
  const second = mount();
  await nextFrame();

  for (const spinner of [first, second]) {
    const animations = spinner.getAnimations({ subtree: true });
    check(animations.length === 1, `A spinner runs one animation, not ${animations.length}`);

    const animated =
      animations[0].effect instanceof KeyframeEffect
        ? animations[0].effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe))
        : [];

    const properties = animated.filter(
      (key) => !["offset", "computedOffset", "easing", "composite"].includes(key),
    );

    check(
      properties.join() === "transform,transform",
      `A spinner animates only transform, not ${properties.join()}`,
    );
  }

  const drift = Math.abs(phase(first) - phase(second));
  check(Math.min(drift, 1600 - drift) < 50, `Spinners share one phase, not ${drift}ms apart`);

  second.style.setProperty("--moon-sync", "0ms");
  const [animation] = second.getAnimations({ subtree: true });
  animation.pause();

  for (let frame = 0; frame < 16; frame += 1) {
    animation.currentTime = frame * 100 + 50;
    check(shownFrame(second) === frame, `Phase ${frame} shows frame ${shownFrame(second)}`);
  }

  return "passed";
}
