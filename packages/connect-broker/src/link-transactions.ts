import {
  LINK_AUTHORIZATION_LIFETIME_SECONDS,
  LINK_POLL_INTERVAL_SECONDS,
  LINK_TRANSACTION_LIFETIME_SECONDS,
  LinkTransactionApproveRequest,
  LinkTransactionLookupRequest,
  LinkTransactionRequest,
  keyFingerprint,
  normalizeUserCode,
} from "@nyte-ai/connect";
import type {
  LinkTransactionCompletion,
  LinkTransactionLookup,
  LinkTransactionOpened,
  LinkTransactionStatus,
} from "@nyte-ai/connect";
import { publicKeySet, sha256 } from "@nyte-ai/connect/signing";
import { lookupOwner, ownerStanding, verifySession } from "./clerk.ts";
import { throttle } from "./context.ts";
import type { Context } from "./context.ts";
import { claimRefusal } from "./environments.ts";
import { Refusal, json, parseBody, requestText } from "./http.ts";
import { verifyLinkProof } from "./proof.ts";
import { claimEnvironment } from "./store/environments.ts";
import {
  approveLinkTransaction,
  cancelLinkTransaction,
  denyLinkTransaction,
  findLinkTransaction,
  findPendingLinkTransaction,
  openLinkTransaction,
} from "./store/link-transactions.ts";
import type { LinkTransaction } from "./store/rows.ts";

function verifyUrl(context: Context): string {
  const origins = context.config.webOrigins;
  const origin = origins.find((candidate) => candidate.startsWith("https://")) ?? origins[0];

  if (origin === undefined) throw new Refusal("internal", 503);

  return `${origin}/link`;
}

async function provenTransaction(
  context: Context,
  input: { readonly request: Request; readonly transactionId: string },
): Promise<{ readonly transaction: LinkTransaction; readonly body: string }> {
  const transaction = await findLinkTransaction(context.db, input.transactionId);

  if (transaction === undefined) throw new Refusal("unauthorized");
  const body = await requestText(input.request);
  const thumbprint = await verifyLinkProof(context, {
    request: input.request,
    body,
    publicKey: { kty: "OKP", crv: "Ed25519", x: transaction.public_key },
  });

  if (thumbprint !== transaction.thumbprint) throw new Refusal("unauthorized");

  return { transaction, body };
}

function resolveState(transaction: LinkTransaction, now: number): LinkTransactionStatus["state"] {
  if (transaction.state === "pending" && transaction.expires_at <= now) return "expired";

  if (
    transaction.state === "approved" &&
    transaction.authorization_expires_at !== null &&
    transaction.authorization_expires_at <= now
  )
    return "expired";

  return transaction.state;
}

export async function openTransaction(context: Context, request: Request): Promise<Response> {
  const text = await requestText(request);
  const body = parseBody(LinkTransactionRequest, text);
  const thumbprint = await verifyLinkProof(context, {
    request,
    body: text,
    publicKey: body.publicKey,
  });

  await throttle(context, "linkOpen", thumbprint);
  const page = verifyUrl(context);
  const code = normalizeUserCode(body.userCode);

  if (code === undefined) throw new Refusal("invalid");
  const now = context.now();

  const opened = await openLinkTransaction(context.db, {
    id: crypto.randomUUID(),
    thumbprint,
    publicKey: body.publicKey.x,
    operationId: body.operationId,
    name: body.name,
    codeHash: await sha256(code),
    now,
    expiresAt: now + LINK_TRANSACTION_LIFETIME_SECONDS * 1000,
  });

  switch (opened.kind) {
    case "code_taken":
    case "conflict":
      throw new Refusal("conflict");
    case "limit":
      throw new Refusal("limit");
    case "opened": {
      const { transaction } = opened;
      const answer: LinkTransactionOpened = {
        transactionId: transaction.id,
        verifyUrl: page,
        expiresAt: transaction.expires_at,
        pollIntervalMs: LINK_POLL_INTERVAL_SECONDS * 1000,
        state: resolveState(transaction, now),
      };

      return json(transaction.created_at === now ? 201 : 200, answer);
    }
    default: {
      const _exhaustive: never = opened;

      return _exhaustive;
    }
  }
}

export async function lookupTransaction(context: Context, request: Request): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "linkLookup", session.userId);
  const body = parseBody(LinkTransactionLookupRequest, await requestText(request));
  const code = normalizeUserCode(body.userCode);

  if (code === undefined) throw new Refusal("not_found");
  const transaction = await findPendingLinkTransaction(context.db, {
    codeHash: await sha256(code),
    now: context.now(),
  });

  if (transaction === undefined) throw new Refusal("not_found");
  const answer: LinkTransactionLookup = {
    transactionId: transaction.id,
    hostName: transaction.name,
    fingerprint: keyFingerprint(transaction.thumbprint),
    expiresAt: transaction.expires_at,
  };

  return json(200, answer);
}

export async function approveTransaction(
  context: Context,
  request: Request,
  transactionId: string,
): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "linkApprove", session.userId);
  const body = parseBody(LinkTransactionApproveRequest, await requestText(request));
  const transaction = await findLinkTransaction(context.db, transactionId);
  const now = context.now();

  if (
    transaction === undefined ||
    resolveState(transaction, now) !== "pending" ||
    keyFingerprint(transaction.thumbprint) !== body.fingerprint
  )
    throw new Refusal("not_found");
  const lookup = await lookupOwner(context, session.userId);

  if ((await ownerStanding(context, { userId: session.userId, recheck: false })) !== "active")
    throw new Refusal("owner_disabled");
  const label =
    (lookup.kind === "found" ? lookup.label : undefined) ?? session.email ?? session.userId;

  const approved = await approveLinkTransaction(context.db, {
    id: transaction.id,
    ownerId: session.userId,
    sessionId: session.sessionId,
    ownerLabel: label,
    now,
    authorizationExpiresAt: now + LINK_AUTHORIZATION_LIFETIME_SECONDS * 1000,
  });

  if (!approved) throw new Refusal("conflict");
  const answer: LinkTransactionStatus = { state: "approved" };

  return json(200, answer);
}

export async function denyTransaction(
  context: Context,
  request: Request,
  transactionId: string,
): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "linkApprove", session.userId);
  const transaction = await findLinkTransaction(context.db, transactionId);

  if (transaction === undefined) throw new Refusal("not_found");
  const denied = await denyLinkTransaction(context.db, { id: transaction.id, now: context.now() });

  if (!denied) throw new Refusal("conflict");
  const answer: LinkTransactionStatus = { state: "denied" };

  return json(200, answer);
}

export async function pollTransaction(
  context: Context,
  request: Request,
  transactionId: string,
): Promise<Response> {
  const { transaction } = await provenTransaction(context, { request, transactionId });

  await throttle(context, "linkPoll", transaction.id);
  const answer: LinkTransactionStatus = { state: resolveState(transaction, context.now()) };

  return json(200, answer);
}

export async function completeTransaction(
  context: Context,
  request: Request,
  transactionId: string,
): Promise<Response> {
  const { transaction } = await provenTransaction(context, { request, transactionId });

  await throttle(context, "linkPoll", transaction.id);
  const now = context.now();

  if (transaction.state === "approved" && transaction.owner_id !== null) {
    const standing = await ownerStanding(context, { userId: transaction.owner_id, recheck: true });

    if (standing === "unavailable") throw new Refusal("internal", 503);
  }

  const claimed = await claimEnvironment(context.db, {
    kind: "transaction",
    transactionId: transaction.id,
    thumbprint: transaction.thumbprint,
    now,
  });

  switch (claimed.kind) {
    case "linked":
    case "recovered": {
      const bound = claimed.kind === "recovered" ? claimed.transaction : transaction;
      const ownerId = bound.owner_id;
      const label = bound.owner_label;

      if (ownerId === null || label === null) throw new Refusal("internal");
      const answer: LinkTransactionCompletion = {
        state: "consumed",
        link: {
          environment: { id: claimed.environment.id, name: bound.name },
          owner: { id: ownerId, label },
          brokerKeys: publicKeySet(context.config.signing.all),
        },
      };

      return json(claimed.kind === "linked" && claimed.fresh ? 201 : 200, answer);
    }
    case "transaction": {
      const answer: LinkTransactionCompletion = { state: claimed.state };

      return json(200, answer);
    }
    default:
      throw new Refusal(claimRefusal(claimed));
  }
}

export async function cancelTransaction(
  context: Context,
  request: Request,
  transactionId: string,
): Promise<Response> {
  const { transaction } = await provenTransaction(context, { request, transactionId });

  await throttle(context, "linkPoll", transaction.id);
  const cancelled = await cancelLinkTransaction(context.db, {
    id: transaction.id,
    thumbprint: transaction.thumbprint,
  });

  if (cancelled === undefined) throw new Refusal("not_found");
  const answer: LinkTransactionStatus = { state: resolveState(cancelled, context.now()) };

  return json(200, answer);
}
