import { IdentityChallengeSchema, isJson, SdkError } from "@nyte-ai/schema";
import type { CredentialSource, HostViewWire, IdentityChallenge, Json } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core/client";
import type { ConnectOptions, Connection } from "@nyte-ai/core";
import { createTransport, decodeError, decodeOutput } from "@nyte-ai/protocol";
import type { Transport } from "@nyte-ai/protocol";
import { createClient } from "./client.ts";
import { createSendJournal } from "../send/journal.ts";
import { parsed } from "./receipts.ts";

const paired = new Map<string, string>();

const encoder = new TextEncoder();

type HostPin = NonNullable<ConnectOptions["expect"]>;

type Fetch = NonNullable<ConnectOptions["fetch"]>;

/** Connects to the host at `options.url`. With `expect`, the host proves the pinned key before any credential is sent, and every failure to is `stale`. Without it, the identity challenge runs beside the first view and decides nothing: the key it proves becomes `Connection.publicKey` when it names the host the first view names, and a challenge that fails leaves the connection without one. */
export async function connect(options: ConnectOptions): Promise<Connection> {
  const { credentials } = options;
  const send = options.fetch ?? fetch;
  const key = credentials.kind === "pairing" ? `${options.url}\n${credentials.code}` : null;
  const kept = key === null ? undefined : paired.get(key);

  const transport = createTransport({
    url: options.url,
    fetch: send,
    headers: () => credentialHeaders(credentials, transport.credential() ?? kept ?? null),
  });

  const proving =
    options.expect === undefined
      ? learnIdentity(options.url, send).catch(() => null)
      : Promise.resolve(await verifyIdentity(options.url, send, options.expect));

  const { view: first, frames } = await firstView(transport);

  try {
    return await openClient(options, transport, first, frames, key, kept, await proving);
  } catch (error) {
    await frames.return?.();
    throw error;
  }
}

async function openClient(
  options: ConnectOptions,
  transport: Transport,
  first: HostViewWire,
  frames: AsyncIterator<Json>,
  key: string | null,
  kept: string | undefined,
  proved: HostPin | null,
): Promise<Connection> {
  const { credentials } = options;
  const answered = transport.host() ?? first.id;

  const named = proved !== null && answered === proved.hostId && first.id === answered;

  if (options.expect !== undefined && !named)
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
    publicKey: named ? proved.publicKey : undefined,
    principal: first.principal,
    credential,
    journal,
    journaled,
    hostFrames: frames,
  });
}

/** Returns the headers a credential sends; a pairing code sends the device token it was traded for once there is one. */
export async function credentialHeaders(
  credentials: CredentialSource,
  device: string | null = null,
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

async function firstView(
  transport: Transport,
): Promise<{ readonly view: HostViewWire; readonly frames: AsyncIterator<Json> }> {
  const frames = transport.frames("connection.watch", {})[Symbol.asyncIterator]();

  try {
    const next = await frames.next();

    if (next.done === true)
      throw new SdkError("unavailable", "The host closed the connection before it answered.");

    return {
      view: decodeOutput("connection.watch", next.value),
      frames: replayFirst(next.value, frames),
    };
  } catch (error) {
    await frames.return?.();
    throw error;
  }
}

function replayFirst(first: Json, rest: AsyncIterator<Json>): AsyncIterator<Json> {
  let replayed = false;

  return {
    async next() {
      if (replayed) return rest.next();
      replayed = true;

      return { done: false, value: first };
    },
    async return() {
      await rest.return?.();

      return { done: true, value: undefined };
    },
  };
}

/**
 * Proves the pinned host before a credential is sent: its answer to a fresh nonce must name
 * `expected.hostId`, carry `expected.publicKey`, and verify under that key. A host that answers no
 * challenge (404) fails, because the pinned key is one it proved before. Every failure is
 * `SdkError("stale")`, and a changed key says to pair again.
 */
async function verifyIdentity(url: string, send: Fetch, expected: HostPin): Promise<HostPin> {
  const nonce = crypto.randomUUID();
  const challenge = await askIdentity(url, send, nonce);

  if (challenge === null)
    throw new SdkError(
      "stale",
      `The server at ${url} answered no identity challenge, so it cannot prove it is host ${expected.hostId}. If you redeployed that host without its identity key, pair again.`,
    );

  if (challenge.hostId !== expected.hostId)
    throw new SdkError(
      "stale",
      `Host ${challenge.hostId} answered instead of ${expected.hostId}.`,
      {
        hostId: challenge.hostId,
      },
    );

  if (challenge.publicKey !== expected.publicKey)
    throw new SdkError(
      "stale",
      `The identity key of host ${challenge.hostId} changed since you paired with it, so another machine could be answering. If that host's identity key was regenerated or Nyte was reinstalled there, pair again.`,
      { hostId: challenge.hostId },
    );

  await checkSignature(challenge, nonce);

  return expected;
}

/**
 * Learns the key of a host this client has not pinned: `null` when it answers no challenge (404),
 * and a rejection, which `connect` reads as no key, when the answer fails. The key is as
 * trustworthy as the channel this connection is made over, exactly as the host id the first view
 * carries is.
 */
async function learnIdentity(url: string, send: Fetch): Promise<HostPin | null> {
  const nonce = crypto.randomUUID();
  const challenge = await askIdentity(url, send, nonce);

  if (challenge === null) return null;
  await checkSignature(challenge, nonce);

  return { hostId: challenge.hostId, publicKey: challenge.publicKey };
}

/** Asks `/.nyte/identity` to sign `nonce`: `null` for a 404, the host's error for any other failure, and `SdkError("invalid")` for an answer that is not a challenge for this nonce. */
async function askIdentity(
  url: string,
  send: Fetch,
  nonce: string,
): Promise<IdentityChallenge | null> {
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

  if (response.status === 404) return null;

  if (!response.ok) throw decodeError(isJson(body) ? body : null, response.status);
  const challenge = parsed(IdentityChallengeSchema, body);

  if (challenge === null || challenge.nonce !== nonce)
    throw new SdkError("invalid", "The host answered the identity challenge with something else.");

  return challenge;
}

/** Throws `SdkError("stale")` unless the challenge's signature over `nyte/identity\n<hostId>\n<nonce>` verifies under the key it carries. */
async function checkSignature(challenge: IdentityChallenge, nonce: string): Promise<void> {
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

  if (!signed)
    throw new SdkError("stale", `The identity signature of ${challenge.hostId} does not verify.`, {
      hostId: challenge.hostId,
    });
}
