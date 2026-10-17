import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { composer } from "./ui.ts";

const timeout = 30_000;

/** What the benches type into the composer, one character per keystroke. */
export const typedText = "startup benchmark keystrokes";

/** The pause between keystrokes after the first. */
export const keystrokeDelayMs = 40;

/** The user-timing measure each keystroke records in the renderer. */
export const keystrokeMeasure = "nyte-bench:keystroke";

/**
 * Measures each keystroke from its keydown to the task after the frame that follows the
 * composer's first DOM change. Editors that cancel beforeinput fire no input event, so the
 * mutation is the editor-neutral sign that the character landed. Each measure's `detail` is the
 * same span without the wait for that frame to begin: keydown to the mutation, plus the frame's
 * start (the animation frame's timestamp) to the task after it. On a 60 Hz display that wait
 * alone spreads the whole span over 0-16.7 ms whatever the build does.
 */
export async function typeAndMeasure(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const field = document.querySelector('[aria-label="Message"][contenteditable="true"]');

    if (field === null) throw new Error("The composer disappeared before typing.");
    let pending: number | undefined;
    document.addEventListener("keydown", (event) => (pending = event.timeStamp), true);
    new MutationObserver(() => {
      const start = pending;

      if (start === undefined) return;
      pending = undefined;
      const landed = performance.now();
      requestAnimationFrame((frame) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          const end = performance.now();
          const work = landed - start + end - Math.max(frame, landed);
          performance.measure(name, { start, end, detail: work });
          channel.port1.close();
        };

        channel.port2.postMessage(null);
      });
    }).observe(field, { subtree: true, childList: true, characterData: true });
  }, keystrokeMeasure);

  const field = composer(page);

  const painted = (count: number) =>
    page.waitForFunction(
      ([name, expected]) => performance.getEntriesByName(name).length >= expected,
      [keystrokeMeasure, count] as const,
      { polling: "raf", timeout },
    );

  await field.pressSequentially(typedText.slice(0, 1), { timeout });
  await painted(1);
  await field.pressSequentially(typedText.slice(1), { delay: keystrokeDelayMs, timeout });
  await expect(field).toHaveText(typedText, { timeout });
  await painted(typedText.length);
}
