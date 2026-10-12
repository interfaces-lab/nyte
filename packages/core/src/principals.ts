import { OPERATION_AUTHORITY, asId } from "@nyte-ai/schema";
import type {
  Authority,
  CallId,
  CredentialSource,
  Disposer,
  HeadName,
  PrincipalId,
  RunId,
  ServedOperation,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";
import { decodePrincipalRecord } from "./records.ts";
import type { PrincipalRecord } from "./records.ts";
import { hostPrincipalsRef } from "./refs.ts";
import { STALE, attempt, commit, expectOf, load, put } from "./session-state.ts";

/** Returns who a connection acts as, what it may do, the credential it reconnects with, and the run it acts from; every handle closes over one. */
export interface ConnectionContext {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly credential: CredentialSource;
  /** The durable step a connection acts from, null for a client; `sequence` keys its acquisitions without an explicit id (`acq:<n>`) and restarts on every re-run of the step. */
  readonly origin: {
    readonly session: SessionId;
    readonly run: RunId | null;
    readonly head: HeadName | null;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null;
}

/** Holds the open connections of each principal in this process, so revoking one drops its streams; a principal revoked here is never registered again. */
export interface ConnectionRegistry {
  /** Admits a principal's connection with how to close it, the disposer forgetting it; a principal revoked here is refused and nothing is recorded. */
  register(
    principal: PrincipalId,
    close: () => void,
  ): { readonly kind: "admitted"; readonly dispose: Disposer } | { readonly kind: "revoked" };
  /** Closes and forgets every connection the principal registered; accepted work continues. */
  revoke(principal: PrincipalId): void;
}

/** The principal `open` connects as, with every authority; reserved, `pair` never mints it (decision 4). */
export const LOCAL: PrincipalId = asId<"principal">("local");

/** The principal a token connects as, with participant and owner; reserved, `pair` never mints it (decision 4). */
export const TOKEN: PrincipalId = asId<"principal">("token");

export const ALL_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>([
  "participant",
  "owner",
  "maintenance",
]);

export const TOKEN_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant", "owner"]);

/** What core acts as on its own behalf: `LOCAL` with participant and owner authority, no credential and no origin. */
export const CORE_CONTEXT: ConnectionContext = {
  principal: LOCAL,
  authority: TOKEN_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

/** What a tool invocation's connection holds. */
export const PARTICIPANT_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const PAIRING_TTL = 10 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const EMPTY: PrincipalRecord = { principals: [], codes: [] };

/** Throws `denied` unless the authority holds what the operation's `OPERATION_AUTHORITY` row needs. */
export function gate(authority: ReadonlySet<Authority>, operation: ServedOperation): void {
  const needed = OPERATION_AUTHORITY[operation].authority;

  if (!authority.has(needed))
    throw new SdkError("denied", `${operation} needs ${needed} authority.`);
}

/** Returns a view of `api` in which `overrides` and a rejected `denied` for each `<kind>.<member>` row the authority lacks replace their members, every other member being the api's own, bound to it; the api itself when nothing differs. Participant rows are not checked (§56): every context in process holds participant, and protocol's server gates each wire row before core sees it. */
export function gated<T extends object>(
  kind: string,
  api: T,
  authority: ReadonlySet<Authority>,
  overrides: Partial<T> = {},
): T {
  const members = new Map<string, unknown>([
    ...Object.entries(OPERATION_AUTHORITY).flatMap(([operation, row]) =>
      operation.startsWith(`${kind}.`) &&
      row.authority !== "participant" &&
      !authority.has(row.authority)
        ? [
            [
              operation.slice(kind.length + 1),
              async () => {
                throw new SdkError("denied", `${operation} needs ${row.authority} authority.`);
              },
            ] as const,
          ]
        : [],
    ),
    ...Object.entries(overrides),
  ]);

  if (members.size === 0) return api;

  return new Proxy(api, {
    get(target, member) {
      // oxlint-disable-next-line no-restricted-globals -- a proxy forwards every other member to its target
      const own: unknown = Reflect.get(target, member, target);
      const value = typeof member === "string" && members.has(member) ? members.get(member) : own;

      return typeof value === "function" && value === own ? value.bind(target) : value;
    },
  });
}

/** Returns `Host.principals` over `host/principals`, each write compare-and-set against the record it read. `revoke` also drops the principal's open connections; an unknown id writes nothing. */
export function createPrincipals(kernel: Kernel): Host["principals"] {
  return {
    async list() {
      const { record } = await readPrincipals(kernel);

      return record.principals.map((principal) => ({
        id: principal.id,
        label: principal.label,
        authority: new Set(principal.authority),
        pairedAt: principal.pairedAt,
        lastSeenAt: principal.lastSeenAt,
      }));
    },
    async pair(input) {
      const code = mintCode();
      const expiresAt = Date.now() + PAIRING_TTL;

      await writePrincipals(kernel, "Minting a pairing code", (record) => ({
        principals: record.principals,
        codes: [
          ...record.codes.filter((entry) => entry.expiresAt > Date.now()),
          {
            code,
            authority: [...input.authority],
            label: input.label ?? "Paired device",
            expiresAt,
          },
        ],
      }));

      return { code, expiresAt };
    },
    async revoke(id) {
      await writePrincipals(kernel, `Revoking ${id}`, (record) =>
        record.principals.some((principal) => principal.id === id)
          ? {
              principals: record.principals.filter((principal) => principal.id !== id),
              codes: record.codes,
            }
          : null,
      );

      kernel.connections.revoke(id);
    },
  };
}

/** Redeems an unexpired pairing code once, adding a principal with a fresh id and device token in the same write; null for an unknown or expired code. The token is stored as its digest only. */
export async function redeemPairing(
  kernel: Kernel,
  code: string,
): Promise<{
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly token: string;
} | null> {
  const token = mintToken();
  const tokenDigest = await sha256(token);
  const principal = asId<"principal">(crypto.randomUUID());

  const written = await writePrincipals(kernel, "Redeeming a pairing code", (record) => {
    const now = Date.now();
    const found = record.codes.find((entry) => entry.code === code && entry.expiresAt > now);

    if (found === undefined) return null;

    return {
      principals: [
        ...record.principals,
        {
          id: principal,
          label: found.label,
          authority: found.authority,
          pairedAt: now,
          lastSeenAt: null,
          tokenDigest,
        },
      ],
      codes: record.codes.filter((entry) => entry !== found && entry.expiresAt > now),
    };
  });

  const granted = written?.principals.find((entry) => entry.id === principal);

  return granted === undefined ? null : { principal, authority: new Set(granted.authority), token };
}

/** Resolves the paired principal a device token names from one read of `host/principals`, writing nothing; null when no principal holds it. */
export async function authenticateToken(
  kernel: Kernel,
  token: string,
): Promise<{ readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> } | null> {
  const digest = await sha256(token);
  const { record } = await readPrincipals(kernel);
  const found = record.principals.find((principal) => principal.tokenDigest === digest);

  return found === undefined ? null : { principal: found.id, authority: new Set(found.authority) };
}

export function createConnectionRegistry(): ConnectionRegistry {
  const open = new Map<PrincipalId, Set<() => void>>();
  const revoked = new Set<PrincipalId>();

  return {
    register(principal, close) {
      if (revoked.has(principal)) return { kind: "revoked" };
      const closers = open.get(principal) ?? new Set<() => void>();
      const entry = () => close();
      closers.add(entry);
      open.set(principal, closers);

      return {
        kind: "admitted",
        dispose() {
          closers.delete(entry);

          if (closers.size === 0 && open.get(principal) === closers) open.delete(principal);
        },
      };
    },
    revoke(principal) {
      const closers = open.get(principal);
      open.delete(principal);
      revoked.add(principal);

      for (const close of closers ?? []) close();
    },
  };
}

async function readPrincipals(kernel: Kernel) {
  const ref = await kernel.store.refs.get(hostPrincipalsRef());

  return { ref, record: (await load(kernel, ref, decodePrincipalRecord))?.record ?? EMPTY };
}

/** Rewrites `host/principals` with what `change` returns, compare-and-set against the record read; a null change writes nothing. */
async function writePrincipals(
  kernel: Kernel,
  what: string,
  change: (record: PrincipalRecord) => PrincipalRecord | null,
): Promise<PrincipalRecord | null> {
  return attempt(what, async () => {
    const { ref, record } = await readPrincipals(kernel);
    const next = change(record);

    if (next === null) return null;

    const outcome = await commit(kernel, [
      {
        name: hostPrincipalsRef(),
        target: await put(kernel, "principals", next),
        expect: expectOf(ref),
      },
    ]);

    return outcome.kind === "set" ? next : STALE;
  });
}

function mintCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const letters = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);

  return `${letters.slice(0, 4).join("")}-${letters.slice(4).join("")}`;
}

function mintToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
