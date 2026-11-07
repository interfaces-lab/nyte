import { Value } from "typebox/value";
import type { TSchema, Static } from "typebox";
import { namesBrokerOrigin } from "./encoding.ts";
import {
  BROKER_ROUTES,
  EnrollResponse,
  EnvironmentList,
  ErrorBody,
  LinkTransactionLookup,
  LinkTransactionStatus,
  REQUEST_TIMEOUT_MS,
  RESPONSE_LIMIT_BYTES,
  UUID_PATTERN,
} from "./schemas.ts";
import type {
  EnrollRequest,
  ErrorCode,
  LinkTransactionApproveRequest,
  LinkTransactionLookupRequest,
} from "./schemas.ts";

export type BrokerFailure =
  | { readonly kind: "signed_out" }
  | { readonly kind: "network" }
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

interface BrokerClientOptions {
  readonly origin: string;
  readonly sessionToken: () => Promise<string | null>;
  readonly fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export interface BrokerClient {
  listEnvironments(input: { readonly signal?: AbortSignal }): Promise<EnvironmentList>;
  enroll(input: {
    readonly environmentId: string;
    readonly request: EnrollRequest;
    readonly signal?: AbortSignal;
  }): Promise<EnrollResponse>;
  revokeDevice(input: {
    readonly environmentId: string;
    readonly deviceId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  removeEnvironment(input: {
    readonly environmentId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  lookupLinkTransaction(input: {
    readonly userCode: string;
    readonly signal?: AbortSignal;
  }): Promise<LinkTransactionLookup>;
  approveLinkTransaction(input: {
    readonly transactionId: string;
    readonly fingerprint: string;
    readonly signal?: AbortSignal;
  }): Promise<LinkTransactionStatus>;
  denyLinkTransaction(input: {
    readonly transactionId: string;
    readonly signal?: AbortSignal;
  }): Promise<LinkTransactionStatus>;
}

const UUID = new RegExp(UUID_PATTERN, "u");

function id(value: string): string {
  if (!UUID.test(value)) throw new BrokerError({ kind: "refused", status: 400, code: "invalid" });

  return value;
}

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
  if (!namesBrokerOrigin(options.origin))
    throw new Error("The connect origin must be a canonical https:// origin.");
  const send = options.fetch ?? fetch;
  const { origin } = options;

  const request = async (input: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly status: number; readonly body: unknown }> => {
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

      if (controller.signal.aborted) throw new BrokerError({ kind: "network" });
      const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });

      if (input.body !== undefined) headers.set("content-type", "application/json");
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

    async lookupLinkTransaction({ userCode, signal }) {
      const body: LinkTransactionLookupRequest = { userCode };

      return parse(
        LinkTransactionLookup,
        await request({ method: "POST", path: BROKER_ROUTES.linkTransactionLookup, body, signal }),
      );
    },

    async approveLinkTransaction({ transactionId, fingerprint, signal }) {
      const body: LinkTransactionApproveRequest = { fingerprint };

      return parse(
        LinkTransactionStatus,
        await request({
          method: "POST",
          path: BROKER_ROUTES.linkTransactionApprove(id(transactionId)),
          body,
          signal,
        }),
      );
    },

    async denyLinkTransaction({ transactionId, signal }) {
      return parse(
        LinkTransactionStatus,
        await request({
          method: "POST",
          path: BROKER_ROUTES.linkTransactionDeny(id(transactionId)),
          signal,
        }),
      );
    },
  };
}
