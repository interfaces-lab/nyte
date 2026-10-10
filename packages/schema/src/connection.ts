import type { Authority, Declaration } from "./declaration.ts";
import type { ValidationIssue } from "./errors.ts";
import type { SendOptions } from "./heads.ts";
import type { CatalogGeneration, HeadName, HostId, ReceiptId, SessionId } from "./ids.ts";
import type { UserContent } from "./messages.ts";
import type { Awaitable, JsonSchema } from "./primitives.ts";
import type { SettingInfo } from "./sessions.ts";

/**
 * Returns the host as one watched view: identity, link, catalog generation,
 * plugins, settings and the served operations.
 *
 * @category connection
 * @since 0.1.0
 */
export type HostView = {
  /** The host's id. */
  readonly id: HostId;
  /**
   * The link state. It changes without the client's action, so it is here,
   * watched.
   */
  readonly link: { readonly kind: "connected" } | { readonly kind: "reconnecting"; readonly since: number; readonly attempts: number } | { readonly kind: "closed"; readonly reason: "client" | "revoked" | "host-gone" };
  /** Machine label. */
  readonly name: string;
  /** Host operating system. */
  readonly platform: string;
  /** Host version. */
  readonly version: string;
  /** Catalog generation; read `models.list()` again when it moves. */
  readonly catalog: CatalogGeneration;
  /** Every loaded plugin with where it came from and its live issues. */
  readonly plugins: readonly { readonly id: string; readonly source: "builtin" | "user" | "project" | "inline"; readonly path: string | null; readonly issues: readonly ValidationIssue[] }[];
  /** Host-scope settings with their current values. */
  readonly settings: readonly SettingInfo[];
  /** What the connected principal may do. A client hides owner-only controls from a participant. */
  readonly authority: ReadonlySet<Authority>;
  /** The declaration table, served: what a non-TS client binds to. */
  readonly operations: readonly { readonly name: string; readonly kind: Declaration<unknown, unknown>["kind"]; readonly authority: Authority; readonly input: JsonSchema; readonly output: JsonSchema }[];
}

/**
 * Returns how a client authenticates: a static token, a one-time pairing
 * code, or headers computed per request.
 *
 * **Details**
 *
 * - `token`: a bearer token.
 * - `pairing`: a code from `host.principals.pair`; exchanged once for a
 *   device credential the sdk keeps.
 * - `custom`: borrowed; `headers()` is called again per request, so it can
 *   refresh.
 *
 * @category connection
 * @since 0.1.0
 */
export type CredentialSource =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "pairing"; readonly code: string }
  | { readonly kind: "custom"; headers(): Awaitable<Readonly<Record<string, string>>> };

/**
 * Records one send the host has not yet acknowledged.
 *
 * @category connection
 * @since 0.1.0
 */
export type JournalEntry = { readonly id: ReceiptId; readonly session: SessionId; readonly head: HeadName; readonly content: UserContent; readonly options: SendOptions; readonly at: number }

/**
 * Returns the result of writing a setting.
 *
 * **Outcomes**
 *
 * - `applied`: the value is stored; dependents re-evaluate.
 * - `invalid`: the value failed the setting's schema; `issues` says where.
 * - `unknown`: no setting has this id.
 *
 * @category connection
 * @since 0.1.0
 */
export type SettingOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" };
