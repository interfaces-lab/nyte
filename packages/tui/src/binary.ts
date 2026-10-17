import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";

/**
 * Runs the CLI from source. Solid JSX compiles as modules load, so the transform must be
 * installed before any app module evaluates, which is why the CLI loads dynamically here.
 * The compiled binary starts at `index.ts`, transformed at build time.
 */
async function runFromSource(): Promise<void> {
  ensureSolidTransformPlugin();
  await import("./index.ts");
}

await runFromSource();
