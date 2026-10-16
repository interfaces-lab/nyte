import { idSchema } from "@nyte-ai/schema";

/** Non-empty is the whole `SessionId` brand invariant, so the check earns the type. */
export const sessionId = idSchema<"session">();
