/** Headless lock for the complete `qa:show` reel. */
import { after, test } from "node:test";
import { boot } from "./driver.ts";
import { playShowSession } from "./walkthrough.ts";

const qa = await boot({ scenario: "tools", resume: true, height: 36 });
after(() => qa.close());

test("qa:show runs every visual QA case", async () => {
  await playShowSession(qa);
});
