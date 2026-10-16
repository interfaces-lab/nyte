import type { Schema } from "./schema.ts";

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

