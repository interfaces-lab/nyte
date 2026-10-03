/**
 * The phone's broker client. Every call carries a fresh Clerk session JWT from
 * `sessionToken`, sent once and never stored here. Answers are size- and
 * time-bounded and checked against the contract before they are returned.
 * Desktop addresses are never taken from an answer: `relayAddress` derives
 * them from this origin.
 */
import { Value } from "typebox/value";
import type { TSchema, Static } from "typebox";
import { isBrokerOrigin } from "./encoding.ts";
import {
  BROKER_ROUTES,
  EnrollResponse,
  EnvironmentList,
  ErrorBody,
  REQUEST_TIMEOUT_MS,
  RESPONSE_LIMIT_BYTES,
  UUID_PATTERN,
} from "./schemas.ts";
import type { EnrollRequest, ErrorCode } from "./schemas.ts";

export type BrokerFailure =
  /** No signed-in Clerk session to authenticate with. */
  | { readonly kind: "signed_out" }
  /** The broker or a session token could not be had in time, or the call was cancelled. */
  | { readonly kind: "network" }
  /** The broker answered outside the contract. */
  | { readonly kind: "bad_response"; readonly status: number }
  | { readonly kind: "refused"; readonly status: number; readonly code: ErrorCode };

export class BrokerError extends Error {
  readonly failure: BrokerFailure;

  constructor(failure: BrokerFailure) {
    super(
      failure.kind === "refused" ? `Broker refused: ${failure.code}` : `Broker ${failure.kind}`,
    );
    this.name = "BrokerError";
    this.failure = failure;
  }
}

export interface BrokerClientOptions {
  /** `CONNECT_ORIGIN`, a canonical `https://` origin such as `https://connect.example.com`. */
  readonly origin: string;
  /**
   * A fresh Clerk session JWT, or null when signed out. Called once per
   * request, inside its timeout: a lookup still pending when the request
   * times out or is aborted is abandoned, and its token is never sent.
   */
  readonly sessionToken: () => Promise<string | null>;
  readonly fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export interface BrokerClient {
  listEnvironments(input: { readonly signal?: AbortSignal }): Promise<EnvironmentList>;
  /**
   * Register a device digest with one environment. It resolves once the
   * desktop recorded the device and the broker activated it; the desktop may
   * refuse the token for up to `ENROLLMENT_READINESS_SECONDS` while its lease
   * catches up.
   */
  enroll(input: {
    readonly environmentId: string;
    readonly request: EnrollRequest;
    readonly signal?: AbortSignal;
  }): Promise<EnrollResponse>;
  /**
   * Revoke a device and the Clerk session that enrolled it: the strong
   * revocation for an owner removing a device or signing out. To drop only
   * this phone's own credential, call the desktop's `DELETE /_nyte/connect/device`
   * with that credential instead; the broker offers phones no weaker route.
   */
  revokeDevice(input: {
    readonly environmentId: string;
    readonly deviceId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  /** Remove a desktop from the account, its relay, and every device. */
  removeEnvironment(input: {
    readonly environmentId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
}

const UUID = new RegExp(UUID_PATTERN, "u");

function id(value: string): string {
  if (!UUID.test(value)) throw new BrokerError({ kind: "refused", status: 400, code: "invalid" });

  return value;
}

/**
 * `start()`'s result, unless `signal` aborts first. A promise that cannot be
 * cancelled, such as a Clerk token lookup, is left to settle on its own and
 * its late value is dropped. Never calls `start` once `signal` has aborted.
 */
function unlessAborted<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new BrokerError({ kind: "network" }));

      return;
    }

    const stop = () => reject(new BrokerError({ kind: "network" }));
    signal.addEventListener("abort", stop);
    const settle = () => signal.removeEventListener("abort", stop);
    let pending: Promise<T>;

    try {
      pending = start();
    } catch (cause) {
      settle();
      reject(cause);

      return;
    }

    pending.then(
      (value) => {
        settle();
        resolve(value);
      },
      (cause: unknown) => {
        settle();
        reject(cause);
      },
    );
  });
}

/** The body as text, refused once it passes the limit. */
async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");

  if (declared > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel();
    throw new BrokerError({ kind: "bad_response", status: response.status });
  }

  const reader = response.body?.getReader();

  if (reader === undefined) {
    const text = await response.text();

    if (text.length > RESPONSE_LIMIT_BYTES)
      throw new BrokerError({ kind: "bad_response", status: response.status });

    return text;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new BrokerError({ kind: "bad_response", status: response.status });
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

export function createBrokerClient(options: BrokerClientOptions): BrokerClient {
  if (!isBrokerOrigin(options.origin))
    throw new Error("The connect origin must be a canonical https:// origin.");
  const send = options.fetch ?? fetch;
  const { origin } = options;

  const request = async (input: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly status: number; readonly body: unknown }> => {
    // The bound starts before the token lookup, so a stalled Clerk cannot hold a
    // call past its timeout or its caller's abort. Timers and listeners rather
    // than AbortSignal.timeout/any, which Hermes may lack.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);

    if (input.signal?.aborted === true) controller.abort();
    input.signal?.addEventListener("abort", abort);

    try {
      let token: string | null;

      try {
        token = await unlessAborted(() => options.sessionToken(), controller.signal);
      } catch (cause) {
        if (cause instanceof BrokerError) throw cause;
        throw new BrokerError({ kind: "network" });
      }

      if (token === null) throw new BrokerError({ kind: "signed_out" });

      // A token that arrived as the bound ran out is not sent.
      if (controller.signal.aborted) throw new BrokerError({ kind: "network" });
      const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });

      if (input.body !== undefined) headers.set("content-type", "application/json");
      // Built apart from the call so runtimes whose `RequestInit` lacks `credentials`
      // (Workers) still accept it; phones and browsers send no cookies with it.
      const init = {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      } as const;
      let response: Response;

      try {
        response = await send(`${origin}${input.path}`, init);
      } catch {
        throw new BrokerError({ kind: "network" });
      }

      if (response.status === 204) {
        await response.body?.cancel();

        return { status: 204, body: undefined };
      }

      let body: unknown;

      try {
        body = JSON.parse(await boundedText(response));
      } catch (cause) {
        if (cause instanceof BrokerError) throw cause;
        throw new BrokerError({
          kind: controller.signal.aborted ? "network" : "bad_response",
          status: response.status,
        });
      }

      if (!response.ok) {
        if (Value.Check(ErrorBody, body))
          throw new BrokerError({
            kind: "refused",
            status: response.status,
            code: body.error.code,
          });
        throw new BrokerError({ kind: "bad_response", status: response.status });
      }

      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
    }
  };

  const parse = <S extends TSchema>(
    schema: S,
    answer: { readonly status: number; readonly body: unknown },
  ): Static<S> => {
    if (!Value.Check(schema, answer.body))
      throw new BrokerError({ kind: "bad_response", status: answer.status });

    return answer.body;
  };

  const empty = (answer: { readonly status: number }): void => {
    if (answer.status !== 204)
      throw new BrokerError({ kind: "bad_response", status: answer.status });
  };

  return {
    async listEnvironments({ signal }) {
      return parse(
        EnvironmentList,
        await request({ method: "GET", path: BROKER_ROUTES.environments, signal }),
      );
    },

    async enroll({ environmentId, request: body, signal }) {
      const answer = await request({
        method: "POST",
        path: BROKER_ROUTES.devices(id(environmentId)),
        body,
        signal,
      });
      const enrolled = parse(EnrollResponse, answer);

      if (enrolled.environmentId !== environmentId)
        throw new BrokerError({ kind: "bad_response", status: answer.status });

      return enrolled;
    },

    async revokeDevice({ environmentId, deviceId, signal }) {
      empty(
        await request({
          method: "DELETE",
          path: BROKER_ROUTES.device(id(environmentId), id(deviceId)),
          signal,
        }),
      );
    },

    async removeEnvironment({ environmentId, signal }) {
      empty(
        await request({
          method: "DELETE",
          path: BROKER_ROUTES.environment(id(environmentId)),
          signal,
        }),
      );
    },
  };
}
