/** Slash commands, end to end, including every command in the registry. */
import { after, test } from "node:test";
import { SLASH_CASES } from "./cases.ts";
import { boot } from "./driver.ts";

const qa = await boot({ resume: true });
after(() => qa.close());

for (const qaCase of SLASH_CASES) test(qaCase.name, () => qaCase.run(qa));
