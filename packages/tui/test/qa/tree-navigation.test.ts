/** A message edited from the session tree appears once when it is sent again. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { BUSY_COMPOSER_PLACEHOLDER } from "../../src/constants.ts";
import { boot } from "./driver.ts";

const qa = await boot({ resume: true });
after(() => qa.close());

test("re-sending a message taken back from the tree draws it once", async () => {
  const prompt = "run the file to be sure it still parses";

  await qa.type("/edit");
  await qa.key("RETURN");
  await qa.until((frame) => frame.includes("Session tree"));
  await qa.type("still parses");
  await qa.key("RETURN");
  await qa.until((frame) => frame.includes("Summarize the branch you are leaving?"));
  await qa.key("RETURN");

  await qa.until((frame) => frame.includes(`❯ ${prompt}`));
  await qa.key("RETURN");
  const submitted = await qa.until((frame) => frame.includes(BUSY_COMPOSER_PLACEHOLDER));
  assert.equal(submitted.match(new RegExp(prompt, "gu"))?.length, 1, submitted);
  await qa.idle();
});
