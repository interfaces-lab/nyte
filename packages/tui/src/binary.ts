import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";

async function runFromSource(): Promise<void> {
  ensureSolidTransformPlugin();
  await import("./index.ts");
}

await runFromSource();
