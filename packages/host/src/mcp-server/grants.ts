import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { compile, McpAccessType, SdkError } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type { McpAccess, McpGrantView } from "@nyte-ai/schema";
import type { OperationInput, OperationOutput } from "@nyte-ai/protocol";
import { parseJson } from "@nyte-ai/protocol";
import { readErrorCode } from "../local/tree.ts";
import { MCP_TOKEN_PREFIX } from "./token.ts";

/** The owner's side of MCP access, answered by the local `mcp.*` operations. */
export interface McpOwner {
  approve(input: OperationInput<"mcp.approve">): Promise<OperationOutput<"mcp.approve">>;
  deny(input: OperationInput<"mcp.deny">): Promise<void>;
  list(): Promise<readonly McpGrantView[]>;
  revoke(input: OperationInput<"mcp.grants.revoke">): Promise<void>;
}

export type McpClient = {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
};

/** An authorization request that passed validation and waits for the owner. */
export type McpSignIn = {
  readonly client: McpClient;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly challenge: string;
  readonly resource: string;
  readonly issuer: string;
  readonly scope: string | null;
};

export type McpGrant = {
  readonly id: string;
  readonly client: string;
  readonly access: McpAccess;
  readonly resource: string;
};

export type McpTokens = {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
};

export type McpIssue =
  | { readonly kind: "issued"; readonly tokens: McpTokens }
  | { readonly kind: "refused"; readonly error: string; readonly description: string };

export type McpSignInState =
  | { readonly kind: "pending" }
  | { readonly kind: "decided"; readonly location: string }
  | { readonly kind: "expired" };

export interface McpGrants extends McpOwner {
  ask(signIn: McpSignIn): { readonly id: string; readonly code: string };
  signInState(id: string): McpSignInState;
  exchange(input: {
    readonly code: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly verifier: string;
    readonly resource: string | null;
  }): Promise<McpIssue>;
  refresh(input: {
    readonly token: string;
    readonly clientId: string;
    readonly resource: string | null;
  }): Promise<McpIssue>;
  authenticate(token: string, resource: string): Promise<McpGrant | null>;
}

type Pending = {
  readonly signIn: McpSignIn;
  readonly code: string;
  readonly expiresAt: number;
  location: string | null;
};

type Code = {
  readonly signIn: McpSignIn;
  readonly access: McpAccess;
  readonly expiresAt: number;
};

const SIGN_IN_MS = 10 * 60 * 1000;

const CODE_MS = 60 * 1000;

const ACCESS_TOKEN_MS = 60 * 60 * 1000;

const REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_PENDING = 32;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const TokenRecordType = Type.Object({ hash: Type.String(), expiresAt: Type.Number() });

const GrantRecordType = Type.Object({
  client: Type.Object({ id: Type.String(), name: Type.String() }),
  access: McpAccessType,
  resource: Type.String(),
  createdAt: Type.Number(),
  accessToken: TokenRecordType,
  refreshToken: TokenRecordType,
});

const GrantFileType = Type.Object({ grants: Type.Record(Type.String(), GrantRecordType) });

const grantFile = compile(GrantFileType);

type GrantFile = Static<typeof GrantFileType>;

type GrantRecord = Static<typeof GrantRecordType>;

/** Keeps MCP grants in `path`, each token only as its SHA-256 digest, re-read on every check so a revoke from another process holds; sign-ins waiting for the owner and authorization codes live in memory. */
export function openMcpGrants(path: string): McpGrants {
  const pending = new Map<string, Pending>();
  const codes = new Map<string, Code>();
  const changes = serial();

  const change = <T>(edit: (file: GrantFile) => { readonly file: GrantFile; readonly result: T }) =>
    changes.run(async () => {
      const edited = edit(await readGrants(path));
      await writeGrants(path, edited.file);

      return edited.result;
    });

  const prune = (now: number): void => {
    for (const entry of pending) if (entry[1].expiresAt <= now) pending.delete(entry[0]);

    for (const entry of codes) if (entry[1].expiresAt <= now) codes.delete(entry[0]);
  };

  const decide = (code: string, location: (signIn: McpSignIn) => string): McpSignIn => {
    prune(Date.now());
    const wanted = normalizeCode(code);

    const found = [...pending.values()].find(
      (entry) => entry.location === null && normalizeCode(entry.code) === wanted,
    );

    if (found === undefined)
      throw new SdkError("unknown", "No MCP sign-in is waiting with that code.");
    found.location = location(found.signIn);

    return found.signIn;
  };

  const issue = (
    record: Omit<GrantRecord, "accessToken" | "refreshToken">,
    now: number,
  ): { readonly record: GrantRecord; readonly tokens: McpTokens } => {
    const access = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const refresh = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

    return {
      record: {
        ...record,
        accessToken: { hash: digest(access), expiresAt: now + ACCESS_TOKEN_MS },
        refreshToken: { hash: digest(refresh), expiresAt: now + REFRESH_TOKEN_MS },
      },
      tokens: {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_MS / 1000,
        refresh_token: refresh,
        scope: record.access.kind === "read-only" ? "read" : "read write",
      },
    };
  };

  return {
    ask(signIn) {
      const now = Date.now();
      prune(now);

      if (pending.size >= MAX_PENDING)
        throw new SdkError("unavailable", "Too many MCP sign-ins are waiting. Try again later.");
      const id = randomBytes(24).toString("base64url");
      const code = displayCode();
      pending.set(id, { signIn, code, expiresAt: now + SIGN_IN_MS, location: null });

      return { id, code };
    },

    signInState(id) {
      prune(Date.now());
      const found = pending.get(id);

      if (found === undefined) return { kind: "expired" };

      if (found.location === null) return { kind: "pending" };

      return { kind: "decided", location: found.location };
    },

    async approve(input) {
      const signIn = decide(input.code, (waiting) => {
        const code = randomBytes(32).toString("base64url");
        codes.set(code, {
          signIn: waiting,
          access: input.access,
          expiresAt: Date.now() + CODE_MS,
        });

        return redirect(waiting, { code });
      });

      return { client: signIn.client.name };
    },

    async deny(input) {
      decide(input.code, (waiting) =>
        redirect(waiting, {
          error: "access_denied",
          error_description: "The host's owner refused the sign-in.",
        }),
      );
    },

    async exchange(input) {
      prune(Date.now());
      const found = codes.get(input.code);
      codes.delete(input.code);

      if (found === undefined)
        return refused("invalid_grant", "The authorization code is unknown, used or expired.");

      if (
        found.signIn.client.id !== input.clientId ||
        found.signIn.redirectUri !== input.redirectUri
      )
        return refused("invalid_grant", "The code was issued to another client or redirect URI.");

      if (input.resource !== null && input.resource !== found.signIn.resource)
        return refused("invalid_target", `Ask for the resource ${found.signIn.resource}.`);

      if (!VERIFIER.test(input.verifier) || challenge(input.verifier) !== found.signIn.challenge)
        return refused("invalid_grant", "The code verifier does not match the code challenge.");

      return change((file) => {
        const now = Date.now();
        const id = randomBytes(12).toString("base64url");

        const issued = issue(
          {
            client: { id: found.signIn.client.id, name: found.signIn.client.name },
            access: found.access,
            resource: found.signIn.resource,
            createdAt: now,
          },
          now,
        );

        return {
          file: { grants: { ...file.grants, [id]: issued.record } },
          result: { kind: "issued", tokens: issued.tokens },
        };
      });
    },

    async refresh(input) {
      const hash = digest(input.token);

      return change((file): { readonly file: GrantFile; readonly result: McpIssue } => {
        const now = Date.now();

        const entry = Object.entries(file.grants).find(
          (candidate) =>
            candidate[1].refreshToken.hash === hash && candidate[1].refreshToken.expiresAt > now,
        );

        if (entry === undefined || entry[1].client.id !== input.clientId)
          return {
            file,
            result: refused("invalid_grant", "The refresh token is unknown, revoked or expired."),
          };

        if (input.resource !== null && input.resource !== entry[1].resource)
          return { file, result: refused("invalid_target", `Ask for ${entry[1].resource}.`) };
        const issued = issue(entry[1], now);

        return {
          file: { grants: { ...file.grants, [entry[0]]: issued.record } },
          result: { kind: "issued", tokens: issued.tokens },
        };
      });
    },

    async authenticate(token, resource) {
      if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
      const hash = digest(token);
      const now = Date.now();
      const file = await readGrants(path);

      const entry = Object.entries(file.grants).find(
        (candidate) =>
          candidate[1].accessToken.hash === hash && candidate[1].accessToken.expiresAt > now,
      );

      if (entry === undefined || entry[1].resource !== resource) return null;

      return {
        id: entry[0],
        client: entry[1].client.name,
        access: entry[1].access,
        resource: entry[1].resource,
      };
    },

    async list() {
      const file = await readGrants(path);

      return Object.entries(file.grants).map((entry) => ({
        id: entry[0],
        client: entry[1].client.name,
        access: entry[1].access,
        createdAt: entry[1].createdAt,
      }));
    },

    async revoke(input) {
      await change((file) => {
        if (!Object.hasOwn(file.grants, input.id))
          throw new SdkError("unknown", `No MCP grant has the id ${input.id}.`);

        return {
          file: {
            grants: Object.fromEntries(
              Object.entries(file.grants).filter((entry) => entry[0] !== input.id),
            ),
          },
          result: null,
        };
      });
    },
  };
}

async function readGrants(path: string): Promise<GrantFile> {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (readErrorCode(error) === "ENOENT") return null;

    throw error;
  });

  if (text === null) return { grants: {} };
  const value = parseJson(text);

  if (!grantFile.Check(value))
    throw new SdkError("internal", `${path} isn't a valid MCP grants file.`);

  return value;
}

async function writeGrants(path: string, file: GrantFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function redirect(signIn: McpSignIn, params: Readonly<Record<string, string>>): string {
  const url = new URL(signIn.redirectUri);

  for (const entry of Object.entries(params)) url.searchParams.set(entry[0], entry[1]);

  if (signIn.state !== null) url.searchParams.set("state", signIn.state);
  url.searchParams.set("iss", signIn.issuer);

  return url.href;
}

function refused(error: string, description: string): McpIssue {
  return { kind: "refused", error, description };
}

function displayCode(): string {
  const letters = Array.from(
    { length: 8 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] ?? "A",
  ).join("");

  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
