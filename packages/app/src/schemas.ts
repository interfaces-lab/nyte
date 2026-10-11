/**
 * Schemas both Electron processes check. Never compiled here: main compiles
 * them, the renderer checks them through `typebox/value` because its CSP
 * forbids the code `Compile` evaluates.
 */
import { idSchema } from "@nyte-ai/schema";

/** Non-empty is the whole `SessionId` brand invariant, so the check earns the type. */
export const sessionId = idSchema<"session">();
