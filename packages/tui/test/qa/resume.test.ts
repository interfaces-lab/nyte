/** `--resume` on a seeded chat: the transcript, the picker, and the tree all see the record. */
import { after, test } from "node:test";
import { RESUME_CASES } from "./cases.ts";
import { boot } from "./driver.ts";

const qa = await boot({ resume: true });
after(() => qa.close());

for (const qaCase of RESUME_CASES) test(qaCase.name, () => qaCase.run(qa));
