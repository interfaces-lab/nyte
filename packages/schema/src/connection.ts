import type { Authority, Declaration } from "./declaration.ts";
import type { ValidationIssue } from "./errors.ts";
import type { SendOptions } from "./heads.ts";
import type { CatalogGeneration, HeadName, HostId, ReceiptId, SessionId } from "./ids.ts";
import type { UserContent } from "./messages.ts";
import type { Awaitable, JsonSchema } from "./primitives.ts";
import type { SettingInfo } from "./sessions.ts";

export type HostView = {
  readonly id: HostId;
  readonly link:
    | { readonly kind: "connected" }
    | { readonly kind: "reconnecting"; readonly since: number; readonly attempts: number }
    | { readonly kind: "closed"; readonly reason: "client" | "revoked" | "host-gone" };
  readonly name: string;
  readonly platform: string;
  readonly version: string;
  readonly catalog: CatalogGeneration;
  readonly plugins: readonly {
    readonly id: string;
    readonly source: "builtin" | "user" | "project" | "inline";
    readonly path: string | null;
    readonly issues: readonly ValidationIssue[];
  }[];
  readonly settings: readonly SettingInfo[];
  readonly authority: ReadonlySet<Authority>;
  readonly operations: readonly {
    readonly name: string;
    readonly kind: Declaration<unknown, unknown>["kind"];
    readonly authority: Authority;
    readonly input: JsonSchema;
    readonly output: JsonSchema;
  }[];
};

export type CredentialSource =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "pairing"; readonly code: string }
  | { readonly kind: "custom"; headers(): Awaitable<Readonly<Record<string, string>>> };

export type JournalEntry = {
  readonly id: ReceiptId;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly content: UserContent;
  readonly options: SendOptions;
  readonly at: number;
};

export type SettingOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" };
