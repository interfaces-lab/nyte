/**
 * One uninterrupted, human-paced pass through the production TUI.
 *
 * This is a recording surface, not a test reporter. Assertions still stop the
 * script on a bad frame, but Bun never prints per-test headings over the TUI.
 */
import process from "node:process";
import { boot } from "./driver.ts";
import { playShowSession, SHOW_STEPS } from "./walkthrough.ts";

if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
  process.stderr.write("Run `pnpm --dir packages/tui qa:show` in an interactive terminal.\n");
  process.exit(2);
}

const qa = await boot({
  scenario: "tools",
  resume: true,
  demoSteps: SHOW_STEPS.length,
});

try {
  await playShowSession(qa);
} finally {
  await qa.close();
}
