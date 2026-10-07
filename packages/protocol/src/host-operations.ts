/**
 * Host operations beside the SDK, for a host that owns a workspace registry:
 * registering a folder, granting it trust, and starting a root session
 * durably. These join `ENVIRONMENT_OPERATIONS` so they share the call route,
 * envelopes and the server's permission hook.
 *
 * Registration and trust are two owner actions. Registering canonicalizes a
 * path on the host and mints an opaque id; trusting binds that id to the
 * folder as it is now (device and inode), so a path that later points
 * elsewhere needs a new grant. Nothing here loads plugins or creates a session.
 *
 * `environment.start` is the one way a root begins on such a host. The host
 * keeps a durable record keyed by the caller's request id: the same request
 * returns the same session and message, a changed request conflicts, and a
 * crash between creation, configuration and admission resumes from the record.
 */
import type { ModelThinkingLevel, UserMessage } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  NonEmptyString,
  Oid,
  SessionId,
  ThinkingLevel,
  UserContent,
  list,
  strict,
  typed,
} from "./schemas.ts";
import type { Oid as OidType } from "./kernel.ts";
import type { SessionId as SessionIdType } from "./sdk.ts";

/** A registered folder's trust, as the owner sees it. */
export type RegisteredTrust =
  /** Registered, no grant, and the folder carries project input: sessions there wait on `workspace_trust`. */
  | { readonly kind: "none" }
  /** Serves without a grant because the folder carries no project input (the `ask` rule). */
  | { readonly kind: "policy" }
  | { readonly kind: "granted"; readonly grantedAt: number }
  /** The path now names another directory than the one registered or granted. */
  | { readonly kind: "changed" }
  | { readonly kind: "unavailable" };

export interface RegisteredWorkspace {
  /** Opaque, stable for this host profile. Never a path. */
  readonly id: string;
  /** The canonical directory on the host, for the owner's eyes. */
  readonly path: string;
  readonly name: string;
  readonly registeredAt: number;
  /**
   * Opaque token for the directory as it is right now. A trust grant echoes
   * it, so approval binds to the folder the owner was shown, not to whatever
   * the path names when the click lands.
   */
  readonly identity: string;
  readonly trust: RegisteredTrust;
}

export type RegisterOutcome =
  | { readonly kind: "registered"; readonly workspace: RegisteredWorkspace }
  /** The canonical directory was already registered; the same row comes back. */
  | { readonly kind: "exists"; readonly workspace: RegisteredWorkspace }
  | { readonly kind: "not_directory"; readonly path: string }
  | { readonly kind: "not_absolute"; readonly path: string }
  /** The host restricts registration to configured roots and this path is outside them. */
  | { readonly kind: "outside_roots"; readonly path: string };

export type TrustOutcome =
  | { readonly kind: "granted"; readonly workspace: RegisteredWorkspace }
  | { readonly kind: "unknown" }
  /** The echoed canonical path differs from the folder the id resolves to now. */
  | { readonly kind: "path_mismatch"; readonly path: string }
  /** The directory changed since the owner looked; the fresh row is returned to look again. */
  | { readonly kind: "identity_changed"; readonly workspace: RegisteredWorkspace }
  | { readonly kind: "unavailable" };

export type ForgetOutcome =
  | { readonly kind: "forgotten" }
  | { readonly kind: "unknown" }
  /** A session in the folder has live work; forgetting would strand it. */
  | { readonly kind: "busy"; readonly sessionId: SessionIdType };

export interface StartInput {
  /** The caller's durable request id, minted once before the first attempt and reused on every retry. */
  readonly requestId: string;
  readonly workspace: { readonly id: string };
  readonly model?: { readonly provider: string; readonly id: string };
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly message: {
    readonly content: UserMessage["content"];
    readonly delivery?: "steer" | "next";
  };
  readonly name?: string;
}

export type StartReceipt =
  | { readonly kind: "accepted"; readonly sessionId: SessionIdType; readonly change: OidType }
  /** The same request id with different input; the first input stands. */
  | { readonly kind: "conflict" }
  | {
      readonly kind: "refused";
      readonly reason:
        | "workspace_unknown"
        | "workspace_untrusted"
        | "workspace_unavailable"
        /** The requested model is not one this host offers. */
        | "model_unknown"
        /** The session this request created was deleted; the request stays tombstoned. */
        | "deleted";
    };

const registeredTrust = typed<RegisteredTrust>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("none") }),
    Type.Object({ kind: Type.Literal("policy") }),
    Type.Object({ kind: Type.Literal("granted"), grantedAt: Type.Number({ minimum: 0 }) }),
    Type.Object({ kind: Type.Literal("changed") }),
    Type.Object({ kind: Type.Literal("unavailable") }),
  ]),
);

export const RegisteredWorkspaceSchema = typed<RegisteredWorkspace>()(
  Type.Object({
    id: NonEmptyString,
    path: NonEmptyString,
    name: Type.String(),
    registeredAt: Type.Number({ minimum: 0 }),
    identity: NonEmptyString,
    trust: registeredTrust,
  }),
);

export const RegisterOutcomeSchema = typed<RegisterOutcome>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("registered"), workspace: RegisteredWorkspaceSchema }),
    Type.Object({ kind: Type.Literal("exists"), workspace: RegisteredWorkspaceSchema }),
    Type.Object({ kind: Type.Literal("not_directory"), path: Type.String() }),
    Type.Object({ kind: Type.Literal("not_absolute"), path: Type.String() }),
    Type.Object({ kind: Type.Literal("outside_roots"), path: Type.String() }),
  ]),
);

export const TrustOutcomeSchema = typed<TrustOutcome>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("granted"), workspace: RegisteredWorkspaceSchema }),
    Type.Object({ kind: Type.Literal("unknown") }),
    Type.Object({ kind: Type.Literal("path_mismatch"), path: Type.String() }),
    Type.Object({ kind: Type.Literal("identity_changed"), workspace: RegisteredWorkspaceSchema }),
    Type.Object({ kind: Type.Literal("unavailable") }),
  ]),
);

export const ForgetOutcomeSchema = typed<ForgetOutcome>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("forgotten") }),
    Type.Object({ kind: Type.Literal("unknown") }),
    Type.Object({ kind: Type.Literal("busy"), sessionId: SessionId }),
  ]),
);

/** Bounded so a request id cannot carry a payload; a uuid fits with room. */
const requestId = Type.String({ minLength: 1, maxLength: 128 });

export const StartInputSchema = typed<StartInput>()(
  strict({
    requestId,
    workspace: strict({ id: NonEmptyString }),
    model: Type.Optional(strict({ provider: Type.String(), id: Type.String() })),
    thinkingLevel: Type.Optional(ThinkingLevel),
    message: strict({
      content: UserContent,
      delivery: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("next")])),
    }),
    name: Type.Optional(Type.String()),
  }),
);

export const StartReceiptSchema = typed<StartReceipt>()(
  Type.Union([
    Type.Object({ kind: Type.Literal("accepted"), sessionId: SessionId, change: Oid }),
    Type.Object({ kind: Type.Literal("conflict") }),
    Type.Object({
      kind: Type.Literal("refused"),
      reason: Type.Enum([
        "workspace_unknown",
        "workspace_untrusted",
        "workspace_unavailable",
        "model_unknown",
        "deleted",
      ]),
    }),
  ]),
);

/** A path as the owner typed it: absolute on the host, canonicalized there. */
const hostPath = Type.String({ minLength: 1, maxLength: 4096 });

export const HOST_OPERATIONS = Object.freeze({
  "environment.workspaces.list": {
    input: Type.Undefined(),
    output: list(RegisteredWorkspaceSchema),
  },
  /** Owner only. Canonicalizes, requires an existing directory, mints or returns the id. Grants nothing. */
  "environment.workspaces.register": {
    input: strict({ path: hostPath }),
    output: RegisterOutcomeSchema,
  },
  /** Owner only. `path` and `identity` must match the folder the id resolves to now; the grant binds to that folder. */
  "environment.workspaces.trust": {
    input: strict({ id: NonEmptyString, path: hostPath, identity: NonEmptyString }),
    output: TrustOutcomeSchema,
  },
  /** Owner only. Removes the row and its grant; refuses while a session there has live work. */
  "environment.workspaces.forget": {
    input: strict({ id: NonEmptyString }),
    output: ForgetOutcomeSchema,
  },
  /** Create, configure and admit one root durably under the caller's request id. */
  "environment.start": { input: StartInputSchema, output: StartReceiptSchema },
});

export type HostOperation = keyof typeof HOST_OPERATIONS;

export type HostOperationInput<V extends HostOperation> = Static<
  (typeof HOST_OPERATIONS)[V]["input"]
>;
