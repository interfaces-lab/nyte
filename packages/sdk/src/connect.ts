import { IdentityChallengeSchema, isJson, SdkError } from "@nyte-ai/schema";
import type { CredentialSource, HostId, HostViewWire } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { ConnectOptions, Connection } from "@nyte-ai/core";
import { createTransport, decodeError, decodeOutput } from "@nyte-ai/protocol";
import type { Transport } from "@nyte-ai/protocol";
import { createClient } from "./client.ts";
import { createSendJournal } from "./journal.ts";
import { parsed } from "./receipts.ts";

const paired = new Map<string, string>();

const encoder = new TextEncoder();

export async function connect(options: ConnectOptions): Promise<Connection> {
  const { credentials } = options;
  const send = options.fetch ?? fetch;
  const key = credentials.kind === "pairing" ? `${options.url}\n${credentials.code}` : null;
  const kept = key === null ? undefined : paired.get(key);

  const transport = createTransport({
    url: options.url,
    fetch: send,
    headers: () => readCredentialHeaders(credentials, transport.credential() ?? kept ?? null),
  });

  if (options.expect !== undefined) await verifyIdentity(options.url, send, options.expect.hostId);
  const first = await firstView(transport);
  const answered = transport.host() ?? first.id;

  if (options.expect !== undefined && (answered !== options.expect.hostId || first.id !== answered))
    throw new SdkError("stale", `Host ${answered} answered instead of ${options.expect.hostId}.`, {
      hostId: answered,
    });

  const token = credentials.kind === "pairing" ? deviceToken(transport, kept) : null;

  if (key !== null && token !== null) paired.set(key, token);
  const credential: CredentialSource = token === null ? credentials : { kind: "token", token };
  const journal = options.journal ?? createSendJournal();
  const journaled = await journal.load();

  dev("sdk", "connected", {
    hostId: first.id,
    credential: credentials.kind,
    journaled: journaled.length,
  });

  return createClient(transport, {
    hostId: first.id,
    principal: first.principal,
    credential,
    journal,
    journaled,
  });
}

async function readCredentialHeaders(
  credentials: CredentialSource,
  device: string | null,
): Promise<Readonly<Record<string, string>>> {
  if (credentials.kind === "custom") return credentials.headers();

  if (credentials.kind === "token") return { Authorization: `Bearer ${credentials.token}` };

  return device === null
    ? { Authorization: `Pairing ${credentials.code}` }
    : { Authorization: `Bearer ${device}` };
}

function deviceToken(transport: Transport, kept: string | undefined): string {
  const token = transport.credential() ?? kept;

  if (token === undefined)
    throw new SdkError(
      "unauthenticated",
      "The host returned no device credential for the pairing code.",
    );

  return token;
}

async function firstView(transport: Transport): Promise<HostViewWire> {
  const frames = transport.frames("connection.watch", {})[Symbol.asyncIterator]();

  try {
    const next = await frames.next();

    if (next.done === true)
      throw new SdkError("unavailable", "The host closed the connection before it answered.");

    return decodeOutput("connection.watch", next.value);
  } finally {
    await frames.return?.();
  }
}

async function verifyIdentity(url: string, send: typeof fetch, expected: HostId): Promise<void> {
  const nonce = crypto.randomUUID();
  let response: Response;

  try {
    response = await send(
      `${url.replace(/\/+$/, "")}/.nyte/identity?nonce=${encodeURIComponent(nonce)}`,
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;

    throw new SdkError("unavailable", error.message);
  }

  const body: unknown = await response.json().catch(() => null);

  if (response.status === 404) return;

  if (!response.ok) throw decodeError(isJson(body) ? body : null, response.status);
  const challenge = parsed(IdentityChallengeSchema, body);

  if (challenge === null || challenge.nonce !== nonce)
    throw new SdkError("invalid", "The host answered the identity challenge with something else.");

  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.fromBase64(challenge.publicKey, { alphabet: "base64url" }),
    "Ed25519",
    false,
    ["verify"],
  );

  const signed = await crypto.subtle.verify(
    "Ed25519",
    key,
    Uint8Array.fromBase64(challenge.signature, { alphabet: "base64url" }),
    encoder.encode(`nyte/identity\n${challenge.hostId}\n${nonce}`),
  );

  if (!signed || challenge.hostId !== expected)
    throw new SdkError(
      "stale",
      signed
        ? `Host ${challenge.hostId} answered instead of ${expected}.`
        : `The identity signature of ${challenge.hostId} does not verify.`,
      { hostId: challenge.hostId },
    );
}
