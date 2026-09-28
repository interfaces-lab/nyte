import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";

// From source, Solid JSX is compiled as modules load, so the transform must be
// installed before any of them; that is the one reason the app is imported
// dynamically here. The binary compiled it at build time.
ensureSolidTransformPlugin();

registerBunOAuthFlows();

await import("./index.ts");
