import type { Schema } from "./schema.ts";
import { OPERATIONS } from "./wire/operations/index.ts";

export type Authority = "participant" | "owner" | "maintenance";

export type Declaration<Input, Output> = {
  readonly input: Schema<Input>;
  readonly output: Schema<Output>;
  readonly kind: "query" | "watch" | "command" | "receipt" | "stream";
  readonly authority: Authority;
  readonly scope: "host" | "session" | "workspace";
  readonly capability?: "files" | "git" | "browser";
  readonly recovery?: "replay" | "never";
  readonly wait?: true;
};

/** Names one served operation: a key of the operations table. */
export type ServedOperation = keyof typeof OPERATIONS;

/** Returns each served operation's authority and scope, read from the operations table. */
export const OPERATION_AUTHORITY: {
  readonly [N in ServedOperation]: Pick<Declaration<unknown, unknown>, "authority" | "scope">;
} = OPERATIONS;
