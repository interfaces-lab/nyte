/** Live turns against the mock provider: reasoning, streaming, tools, interrupts, failures. */
import { after, test } from "node:test";
import { CHAT_CASES } from "./cases.ts";
import { boot } from "./driver.ts";

const qa = await boot();
after(() => qa.close());

for (const qaCase of CHAT_CASES) test(qaCase.name, () => qaCase.run(qa));
