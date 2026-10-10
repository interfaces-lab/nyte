import type { JsonSchema, RunId, Schema, SessionCatalogView, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ToolSource } from "./tool-runner.ts";

/** Returns what a session's plugins contributed, from its materialised registries, each item with its owner: commands (side `core`, `arguments` as JSON Schema or null), settings (`settingInfos`), skills, agents (`description` and `model` null when absent, `mode` default `all`) and tools (`toolSource(kernel, session, null).list()`). */
export function sessionCatalog(kernel: Kernel, session: SessionId): Promise<SessionCatalogView> {
  throw new Error("not implemented");
}

/** Computes the session's catalog and, when it differs from the one last published, sets it with `kernel.setCatalog` (which publishes the `catalog` event) and bumps `kernel.host`'s `catalog` generation. The plugin runtime calls it after every reload pass; settings changes call it for the sessions that list the setting. */
export function publishCatalog(kernel: Kernel, session: SessionId): Promise<void> {
  throw new Error("not implemented");
}

/** Returns a session's tools for one run, from its tools registry: `get` resolves any tool by name with its owner, whatever its exposure; `list` returns each as `ToolInfo` (parameters and output through `jsonSchemaOf`), a deferred tool activated for this run listed as `model`; `activate` marks deferred tools for this run alone (a no-op when `run` is null), kept in memory until the run ends. What `kernel.tools` returns. */
export function toolSource(kernel: Kernel, session: SessionId, run: RunId | null): ToolSource {
  throw new Error("not implemented");
}

/** Returns a schema's JSON Schema in one direction (`input` for what a caller sends: tool parameters, command arguments; `output` for what is shown: tool output, settings), computed once per schema object and cached. Throws what the schema's `jsonSchema` throws, or `SdkError("invalid")` when the result is not JSON; the runtime calls it at load, so a throw is a load-time issue and never a request-time failure. */
export function jsonSchemaOf(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema {
  throw new Error("not implemented");
}
