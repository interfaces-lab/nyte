/** `@` mentions: the file menu opens on the token under the cursor and folds into a tag. */
import { after, test } from "node:test";
import { MENTION_CASES } from "./cases.ts";
import { boot } from "./driver.ts";

const qa = await boot();
after(() => qa.close());

for (const qaCase of MENTION_CASES) test(qaCase.name, () => qaCase.run(qa));
