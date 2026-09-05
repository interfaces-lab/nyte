/**
 * `@nyte-ai/protocol`: the wire contract between a Nyte host and a client in
 * another process. Types the SDK already defines as plain data, the runtime
 * schemas that check them, the verb table, the JSON and SSE envelopes.
 *
 * Depends on `@nyte-ai/schema` and `typebox` only. Never on core, never on
 * Node: a browser bundle and a server share this module unchanged.
 */
export * from "./kernel.ts";
export * from "./views.ts";
export * from "./plugins.ts";
export * from "./workspace.ts";
export * from "./sdk.ts";
export * from "./remote.ts";
export * from "./verbs.ts";
export * from "./wire.ts";
export * from "./parse.ts";
export * from "./sse.ts";
export * as schemas from "./schemas.ts";
