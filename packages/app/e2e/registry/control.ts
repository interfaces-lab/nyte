/**
 * The line protocol between a registry host process and the test that owns
 * it. The host prints one `Ready` line, then answers each `StateRequest` on
 * stdin with what its runtime holds. Closing stdin stops the host.
 */
import { Type } from "typebox";
import type { Static } from "typebox";

export const Ready = Type.Object({
  kind: Type.Literal("ready"),
  address: Type.String(),
  token: Type.String(),
  hostId: Type.String(),
});

export type Ready = Static<typeof Ready>;

export const StateRequest = Type.Object({ id: Type.Integer(), kind: Type.Literal("state") });

export type StateRequest = Static<typeof StateRequest>;

const Root = Type.Object({ sessionId: Type.String(), cwd: Type.String() });

const Folder = Type.Object({
  id: Type.String(),
  path: Type.String(),
  identity: Type.String(),
  trust: Type.String(),
});

export const StateReply = Type.Union([
  Type.Object({
    id: Type.Integer(),
    kind: Type.Literal("state"),
    /** Every root the runtime shows a client, archived included. */
    roots: Type.Array(Root),
    /** The host's registry rows, with each row's trust kind. */
    folders: Type.Array(Folder),
  }),
  Type.Object({ id: Type.Integer(), kind: Type.Literal("error"), message: Type.String() }),
]);

export type StateReply = Static<typeof StateReply>;

export type HostState = Extract<StateReply, { readonly kind: "state" }>;
