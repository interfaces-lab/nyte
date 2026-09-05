/**
 * Schemas both Electron processes check, taken from the wire protocol so the
 * desktop and a remote client validate the same shapes. Never compiled here:
 * main compiles them, the renderer checks them through `typebox/value`
 * because its CSP forbids the code `Compile` evaluates.
 */
import { schemas } from "@nyte-ai/protocol";

/** Non-empty is the whole `SessionId` brand invariant, so the check earns the type. */
export const sessionId = schemas.SessionId;

/** What a user turn or pending item carries. */
export const userContent = schemas.UserContent;
