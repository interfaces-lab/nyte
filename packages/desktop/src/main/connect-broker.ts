/**
 * The desktop's broker client. Every call carries a request proof signed by
 * the machine key; only `link` also carries a Clerk session JWT, sent once and
 * never kept. Answers are read up to the contract's size limit and timeout,
 * redirects are refused, and every body is checked against its schema before
 * it is returned. The relay socket's URL and first-frame proof come from here
 * too, so the broker origin is decided in one place.
 */
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";
import {
  BROKER_ROUTES,
  BrokerError,
  BrokerKeys,
  ErrorBody,
  LeaseResponse,
  LinkResponse,
  PROOF_HEADER,
  ProofClaims,
  REQUEST_TIMEOUT_MS,
  RESPONSE_LIMIT_BYTES,
  UUID_PATTERN,
  isBrokerOrigin,
  relayAddress,
} from "@nyte-ai/connect";
import type { PublicJwk } from "@nyte-ai/connect";
import { createProof, keyThumbprint, publicKeyOf } from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";

export type BrokerFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface DesktopBrokerOptions {
  readonly origin: string;
  readonly fetch?: BrokerFetch;
}

/** A lease as the broker sent it, with the proof `jti` and the moment it was asked for. */
export interface LeaseAnswer {
  readonly lease: string;
  readonly request: string;
  readonly sentAt: number;
}

const UUID = new RegExp(UUID_PATTERN, "u");

function id(value: string): string {
  if (!UUID.test(value)) throw new BrokerError({ kind: "refused", status: 400, code: "invalid" });

  return value;
}

/** The `jti` of a proof this process just signed. */
function proofId(proof: string): string {
  const [, payload] = proof.split(".");
  const claims: unknown = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));

  if (!Value.Check(ProofClaims, claims)) throw new Error("Unexpected proof claims");

  return claims.jti;
}

/** The body as text, refused once it passes the limit. */
async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");

  if (declared > RESPONSE_LIMIT_BYTES) throw new Error("Answer too large");
  const reader = response.body?.getReader();

  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error("Answer too large");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export class DesktopBroker {
  private readonly origin: string;
  private readonly send: BrokerFetch;

  constructor(options: DesktopBrokerOptions) {
    if (!isBrokerOrigin(options.origin))
      throw new Error("The broker origin is not canonical HTTPS");
    this.origin = options.origin;
    this.send = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Where phones reach this environment through the relay. */
  address(environmentId: string): string {
    return relayAddress(this.origin, environmentId);
  }

  /** The relay socket for this environment, on the broker's own origin. */
  relayUrl(environmentId: string): string {
    const url = new URL(BROKER_ROUTES.relay(id(environmentId)), this.origin);
    url.protocol = "wss:";

    return url.href;
  }

  /** The relay's `auth` frame proof: `GET` on the relay path with an empty body. */
  relayProof(input: { readonly key: PrivateJwk; readonly environmentId: string }): Promise<string> {
    return createProof({
      key: input.key,
      issuer: id(input.environmentId),
      audience: this.origin,
      method: "GET",
      path: BROKER_ROUTES.relay(input.environmentId),
      body: "",
    });
  }

  /**
   * Register this Mac under the signed-in account. The proof's issuer is the
   * key's thumbprint, so retrying with the same key resumes an unfinished link.
   */
  async link(input: {
    readonly key: PrivateJwk;
    readonly name: string;
    readonly sessionToken: string;
    readonly signal: AbortSignal;
  }): Promise<LinkResponse> {
    const publicKey: PublicJwk = publicKeyOf(input.key);

    const answer = await this.request({
      key: input.key,
      issuer: await keyThumbprint(publicKey),
      method: "POST",
      path: BROKER_ROUTES.environments,
      body: { publicKey, name: input.name },
      sessionToken: input.sessionToken,
      signal: input.signal,
    });

    return this.parse(LinkResponse, answer);
  }

  async lease(input: {
    readonly key: PrivateJwk;
    readonly environmentId: string;
    readonly signal: AbortSignal;
  }): Promise<LeaseAnswer> {
    const sentAt = Date.now();
    let request = "";

    const answer = await this.request({
      key: input.key,
      issuer: id(input.environmentId),
      method: "POST",
      path: BROKER_ROUTES.lease(input.environmentId),
      body: {},
      signal: input.signal,
      sent: (proof) => {
        request = proofId(proof);
      },
    });

    return { lease: this.parse(LeaseResponse, answer).lease, request, sentAt };
  }

  async removeEnvironment(input: {
    readonly key: PrivateJwk;
    readonly environmentId: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    this.empty(
      await this.request({
        key: input.key,
        issuer: id(input.environmentId),
        method: "DELETE",
        path: BROKER_ROUTES.environment(input.environmentId),
        signal: input.signal,
      }),
    );
  }

  async revokeDevice(input: {
    readonly key: PrivateJwk;
    readonly environmentId: string;
    readonly deviceId: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    this.empty(
      await this.request({
        key: input.key,
        issuer: id(input.environmentId),
        method: "DELETE",
        path: BROKER_ROUTES.device(input.environmentId, id(input.deviceId)),
        signal: input.signal,
      }),
    );
  }

  /** End a device that dropped its own token here; its Clerk session is left alone. */
  async releaseDevice(input: {
    readonly key: PrivateJwk;
    readonly environmentId: string;
    readonly deviceId: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    this.empty(
      await this.request({
        key: input.key,
        issuer: id(input.environmentId),
        method: "POST",
        path: BROKER_ROUTES.release(input.environmentId, id(input.deviceId)),
        body: {},
        signal: input.signal,
      }),
    );
  }

  /** The broker's published signing keys, read when a token names a key this Mac does not hold. */
  async keys(input: { readonly signal: AbortSignal }): Promise<BrokerKeys> {
    const answer = await this.fetch({
      path: BROKER_ROUTES.keys,
      init: { method: "GET", headers: new Headers({ accept: "application/json" }) },
      signal: input.signal,
    });

    return this.parse(BrokerKeys, answer);
  }

  private async request(input: {
    readonly key: PrivateJwk;
    readonly issuer: string;
    readonly method: "POST" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly sessionToken?: string;
    readonly signal: AbortSignal;
    readonly sent?: (proof: string) => void;
  }): Promise<{ readonly status: number; readonly body: unknown }> {
    const body = input.body === undefined ? "" : JSON.stringify(input.body);

    const proof = await createProof({
      key: input.key,
      issuer: input.issuer,
      audience: this.origin,
      method: input.method,
      path: input.path,
      body,
    });

    const headers = new Headers({ accept: "application/json", [PROOF_HEADER]: proof });

    if (input.sessionToken !== undefined)
      headers.set("authorization", `Bearer ${input.sessionToken}`);

    if (input.body !== undefined) headers.set("content-type", "application/json");
    input.sent?.(proof);

    return this.fetch({
      path: input.path,
      init: { method: input.method, headers, body: body === "" ? undefined : body },
      signal: input.signal,
    });
  }

  private async fetch(input: {
    readonly path: string;
    readonly init: RequestInit;
    readonly signal: AbortSignal;
  }): Promise<{ readonly status: number; readonly body: unknown }> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    let response: Response;
    let text: string;

    try {
      response = await this.send(`${this.origin}${input.path}`, {
        ...input.init,
        redirect: "error",
        signal,
      });
      text = await limitedText(response);
    } catch {
      throw new BrokerError({ kind: "network" });
    }

    if (response.status === 204) {
      if (text !== "") throw new BrokerError({ kind: "bad_response", status: 204 });

      return { status: 204, body: undefined };
    }

    let body: unknown;

    try {
      body = JSON.parse(text);
    } catch {
      throw new BrokerError({ kind: "bad_response", status: response.status });
    }

    if (!response.ok) {
      if (Value.Check(ErrorBody, body))
        throw new BrokerError({ kind: "refused", status: response.status, code: body.error.code });
      throw new BrokerError({ kind: "bad_response", status: response.status });
    }

    return { status: response.status, body };
  }

  private parse<S extends TSchema>(
    schema: S,
    answer: { readonly status: number; readonly body: unknown },
  ): Static<S> {
    if (answer.status === 204 || !Value.Check(schema, answer.body))
      throw new BrokerError({ kind: "bad_response", status: answer.status });

    return answer.body;
  }

  private empty(answer: { readonly status: number }): void {
    if (answer.status !== 204)
      throw new BrokerError({ kind: "bad_response", status: answer.status });
  }
}
