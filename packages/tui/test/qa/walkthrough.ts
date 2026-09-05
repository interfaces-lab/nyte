/** The complete visual QA reel, using the same cases as the headless suite. */
import { QA_SHOW_SECTIONS } from "./cases.ts";
import type { Qa } from "./driver.ts";

export const SHOW_STEPS = QA_SHOW_SECTIONS.flatMap((section) =>
  section.cases.map((qaCase) => `${section.label} · ${qaCase.label}`),
);

export async function playShowSession(qa: Qa): Promise<void> {
  for (const section of QA_SHOW_SECTIONS) {
    if (section.prepare === "clear_draft") await qa.clear();
    for (const qaCase of section.cases) {
      await qa.demo(`${section.label} · ${qaCase.label}`);
      switch (qaCase.kind) {
        case "action":
          await qaCase.run(qa);
          await qa.pause();
          break;
        case "exit":
          // The last frame needs its screen time before `/quit` destroys it.
          await qa.pause();
          await qaCase.run(qa);
          break;
      }
    }
  }
}
