import type { HeadName } from "@nyte-ai/core";
import { sleep } from "workflow";
import { driveNyte } from "@nyte-ai/vercel/workflow";
import { advanceSession } from "../src/advance.ts";

export async function runSession(id: string, head: HeadName): Promise<void> {
  "use workflow";
  await driveNyte({ wait: sleep, advance: () => advanceSession(id, head) });
}
