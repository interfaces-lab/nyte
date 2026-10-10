import { asId } from "@nyte-ai/schema";
import type { Authority, Disposer, PrincipalId } from "@nyte-ai/schema";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";
import { decodePrincipalRecord } from "./records.ts";
import type { PrincipalRecord } from "./records.ts";
import { hostPrincipalsRef } from "./refs.ts";
import { STALE, attempt, commit, expectOf, load, put } from "./session-state.ts";

/** Holds the open connections of each principal in this process, so revoking one drops its streams; what the host's listener registers every authenticated connection with. One per kernel (`kernel.connections`), built on first use. */
export interface ConnectionRegistry {
  /** Records a principal's connection and how to close it; the disposer forgets it (the connection closed on its own). */
  register(principal: PrincipalId, close: () => void): Disposer;
  /** Closes and forgets every connection the principal registered; accepted work continues. */
  revoke(principal: PrincipalId): void;
}

const PAIRING_TTL = 10 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const EMPTY: PrincipalRecord = { principals: [], codes: [] };

/** Returns `Host.principals` over `host/principals` (absent reads as no principals and no codes; each write compare-and-sets the ref and retries once on a lost race). `list` returns every paired principal as a `PrincipalView`. `pair` mints a random code that expires in ten minutes, granting `authority` under `label` (default "Paired device"), and drops expired codes. `revoke` removes the principal from the record and calls `kernel.connections.revoke`; an unknown id resolves without writing. What `kernel.principals` holds. */
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

/** Redeems a pairing code once, as the host's listener does for a `{ kind: "pairing" }` credential: an unexpired code is removed and a principal with a fresh id (never `local` or `token`, decision 4), the code's label and authority, `pairedAt` now and a fresh device token, stored as its digest, is added in the same write; resolves the principal, its authority and the token the device keeps (`Connection.credential`, decision 11). Null for an unknown or expired code. */
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

/** Resolves the paired principal a device token names, comparing its SHA-256 digest with each stored one, and records `lastSeenAt`; null when no principal holds it. What the host's listener calls for a `{ kind: "token" }` credential that is not the host's own token. */
export async function authenticateToken(
  kernel: Kernel,
  token: string,
): Promise<{ readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> } | null> {
  const digest = await sha256(token);
  const { record } = await readPrincipals(kernel);
  const found = record.principals.find((principal) => principal.tokenDigest === digest);

  if (found === undefined) return null;

  await writePrincipals(kernel, `Marking ${found.id} seen`, (current) =>
    current.principals.some((principal) => principal.id === found.id)
      ? {
          principals: current.principals.map((principal) =>
            principal.id === found.id ? { ...principal, lastSeenAt: Date.now() } : principal,
          ),
          codes: current.codes,
        }
      : null,
  );

  return { principal: found.id, authority: new Set(found.authority) };
}

/** Returns an empty connection registry: what `kernel.connections` holds. */
export function createConnectionRegistry(): ConnectionRegistry {
  const open = new Map<PrincipalId, Set<() => void>>();

  return {
    register(principal, close) {
      const closers = open.get(principal) ?? new Set<() => void>();
      const entry = () => close();
      closers.add(entry);
      open.set(principal, closers);

      return () => {
        closers.delete(entry);

        if (closers.size === 0 && open.get(principal) === closers) open.delete(principal);
      };
    },
    revoke(principal) {
      const closers = open.get(principal);
      open.delete(principal);

      for (const close of closers ?? []) close();
    },
  };
}

async function readPrincipals(kernel: Kernel) {
  const ref = await kernel.store.refs.get(hostPrincipalsRef());

  return { ref, record: (await load(kernel, ref, decodePrincipalRecord))?.record ?? EMPTY };
}

/** Rewrites `host/principals` with what `change` returns, compare-and-set against the revision read, once more after a lost race, and returns the record written; a null change writes nothing and returns null. */
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
