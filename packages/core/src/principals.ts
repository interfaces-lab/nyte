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
import { commit, readRefExpectation, load, put } from "./session-state.ts";

export interface ConnectionContext {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly credential: CredentialSource;

  readonly origin: {
    readonly session: SessionId;
    readonly run: RunId | null;
    readonly head: HeadName | null;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null;
}

export interface ConnectionRegistry {
  register(
    principal: PrincipalId,
    close: () => void,
  ): { readonly kind: "admitted"; readonly dispose: Disposer } | { readonly kind: "revoked" };

  revoke(principal: PrincipalId): void;
}

export const LOCAL: PrincipalId = asId<"principal">("local");

export const TOKEN: PrincipalId = asId<"principal">("token");

export const ALL_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>([
  "participant",
  "owner",
  "maintenance",
]);

export const TOKEN_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant", "owner"]);

export const CORE_CONTEXT: ConnectionContext = {
  principal: LOCAL,
  authority: TOKEN_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

export const PARTICIPANT_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const PAIRING_TTL = 10 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const EMPTY: PrincipalRecord = { principals: [], codes: [] };

export function gate(authority: ReadonlySet<Authority>, operation: ServedOperation): void {
  const needed = OPERATION_AUTHORITY[operation].authority;

  if (!authority.has(needed))
    throw new SdkError("denied", `${operation} needs ${needed} authority.`);
}

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

export function createPrincipals(kernel: Kernel): Host["principals"] {
  return {
    async list() {
      const { record } = await readPrincipals(kernel);

      return record.principals.map((principal) => ({
        id: principal.id,
        label: principal.label,
        authority: new Set(principal.authority),
        pairedAt: principal.pairedAt,
      }));
    },
    async pair(input) {
      if (!input.authority.has("participant"))
        throw new SdkError("invalid", "A pairing code needs participant authority.");
      const code = mintCode();
      const codeDigest = await sha256(code);
      const expiresAt = Date.now() + PAIRING_TTL;

      await writePrincipals(kernel, (record) => ({
        principals: record.principals,
        codes: [
          ...record.codes.filter((entry) => entry.expiresAt > Date.now()),
          {
            code: codeDigest,
            authority: [...input.authority],
            label: input.label ?? "Paired device",
            expiresAt,
          },
        ],
      }));

      return { code, expiresAt };
    },
    async revoke(id) {
      const written = await writePrincipals(kernel, (record) =>
        record.principals.some((principal) => principal.id === id)
          ? {
              principals: record.principals.filter((principal) => principal.id !== id),
              codes: record.codes,
            }
          : null,
      );

      if (written !== null) kernel.connections.revoke(id);
    },
  };
}

export async function redeemPairing(
  kernel: Kernel,
  code: string,
): Promise<{
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly token: string;
} | null> {
  const token = mintToken();
  const [tokenDigest, codeDigest] = await Promise.all([sha256(token), sha256(code)]);
  const principal = asId<"principal">(crypto.randomUUID());

  const written = await writePrincipals(kernel, (record) => {
    const now = Date.now();
    const found = record.codes.find((entry) => entry.code === codeDigest && entry.expiresAt > now);

    if (found === undefined) return null;

    return {
      principals: [
        ...record.principals,
        {
          id: principal,
          label: found.label,
          authority: found.authority,
          pairedAt: now,
          tokenDigest,
        },
      ],
      codes: record.codes.filter((entry) => entry !== found && entry.expiresAt > now),
    };
  });

  const granted = written?.principals.find((entry) => entry.id === principal);

  return granted === undefined ? null : { principal, authority: new Set(granted.authority), token };
}

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

async function writePrincipals(
  kernel: Kernel,
  change: (record: PrincipalRecord) => PrincipalRecord | null,
): Promise<PrincipalRecord | null> {
  for (;;) {
    const { ref, record } = await readPrincipals(kernel);
    const next = change(record);

    if (next === null) return null;

    const outcome = await commit(kernel, [
      {
        name: hostPrincipalsRef(),
        target: await put(kernel, "principals", next),
        expect: readRefExpectation(ref),
      },
    ]);

    if (outcome.kind === "set") return next;
  }
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
