import type { Authority } from "./host.ts";
import type { Schema } from "./schema.ts";

export type Declaration<Input, Output> = {
  /** One sentence, third person: "Starts a chat with its first message." */
  readonly summary: string;
  readonly input: Schema<Input>;
  readonly output: Schema<Output>;
  readonly kind: "query" | "watch" | "command" | "receipt" | "stream";
  readonly authority: Authority;
  readonly scope: "host" | "session" | "workspace";
  readonly capability?: "files" | "git" | "github" | "browser";
  readonly recovery?: "replay" | "never";
  readonly wait?: true;
  readonly local?: true;
};
