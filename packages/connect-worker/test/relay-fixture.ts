/**
 * The relay in real workerd: the Worker, the relay Durable Object with
 * hibernatable sockets, D1, and real WebSockets and HTTP from this process.
 * Each `relay-*.test.ts` file calls `withWorkerdRelay` for a broker of its own.
 */
import { BROKER_ROUTES, EnrollResponse } from "@nyte-ai/connect";
import { RELAY_REFUSALS, RELAY_RESPONSE_HEADER_NAMES } from "@nyte-ai/connect/relay";
import type { RelayRefusalCode } from "@nyte-ai/connect/relay";
import { createProof, sha256 } from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";
import { RelayDesktop, enrollmentHandler, startWorkerdBroker } from "./workerd.ts";
import type { RelayHandler, WorkerdBroker } from "./workerd.ts";

/** The file's broker, live once `withWorkerdRelay` has started it. */
export let broker: WorkerdBroker;

const open: RelayDesktop[] = [];

/** Start one broker for the calling test file, and before each test close its sockets and empty its state. */
export function withWorkerdRelay(): void {
  beforeAll(async () => {
    broker = await startWorkerdBroker();
  });

  afterAll(async () => {
    await broker.close();
  });

  beforeEach(async () => {
    for (const desktop of open.splice(0)) desktop.close();
    await broker.reset();
  });
}

export const deviceToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const echo: RelayHandler = async (request) => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: `${request.method} ${request.path}`,
});

export async function linked(
  userId = "user_alice",
): Promise<{ environmentId: string; key: PrivateJwk }> {
  const { environmentId, key } = await broker.link({ userId });

  return { environmentId, key };
}

export async function attached(input: {
  environmentId: string;
  key: PrivateJwk;
}): Promise<RelayDesktop> {
  const desktop = await broker.attach(input);

  open.push(desktop);

  return desktop;
}

/** A raw socket on the environment's relay that has not proven anything. */
export async function socket(environmentId: string): Promise<RelayDesktop> {
  const desktop = new RelayDesktop(
    broker.localUrl(`${broker.origin}${BROKER_ROUTES.relay(environmentId)}`),
  );

  open.push(desktop);
  await desktop.opened();

  return desktop;
}

export function relayProof(input: { environmentId: string; key: PrivateJwk; path?: string }) {
  return createProof({
    key: input.key,
    issuer: input.environmentId,
    audience: broker.origin,
    method: "GET",
    path: input.path ?? BROKER_ROUTES.relay(input.environmentId),
    body: "",
  });
}

/** A desktop on its relay with one enrolled phone, answering with `handler`. */
export async function enrolled(
  handler: RelayHandler = echo,
  userId = "user_alice",
  origin?: string,
) {
  const { environmentId, key } = await linked(userId);
  const desktop = await attached({ environmentId, key });
  const bearer = deviceToken();

  desktop.handler = enrollmentHandler({
    key,
    environmentId,
    origin: broker.origin,
    brokerKeys: broker.brokerKeys,
    fallback: handler,
  });
  const answer = await broker.fetch(`${broker.origin}${BROKER_ROUTES.devices(environmentId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await broker.sessionToken({
        userId,
        sessionId: "sess_phone",
        claims: origin === undefined ? {} : { azp: origin },
      })}`,
      ...(origin === undefined ? {} : { origin }),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientId: "phone-install-0001",
      clientName: "Pocket",
      digest: await sha256(bearer),
    }),
  });
  const body: unknown = await answer.json();

  expect(answer.status).toBe(201);

  if (origin !== undefined) expectCors(answer, origin);

  if (!Value.Check(EnrollResponse, body))
    throw new Error("Enrollment answered outside the contract");

  return { environmentId, key, desktop, bearer, deviceId: body.deviceId };
}

export function phone(
  input: { environmentId: string; bearer?: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (input.bearer !== undefined) headers.set("authorization", `Bearer ${input.bearer}`);

  return broker.fetch(`${broker.origin}/r/${input.environmentId}${path}`, {
    method: "POST",
    ...init,
    headers,
  });
}

export async function wireError(response: Response): Promise<{ status: number; body: unknown }> {
  const body: unknown = await response.json();

  return { status: response.status, body };
}

export const refused = (status: number, refusal: RelayRefusalCode) => ({
  status,
  body: {
    code: RELAY_REFUSALS[refusal].code,
    message: RELAY_REFUSALS[refusal].message,
    hostId: null,
    issues: [],
    correlation: null,
  },
});

export const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * When the relay closes a socket that never sent a frame, local workerd sends
 * the close frame and receives the client's reply, but the Node client is
 * left in CLOSING and never fires `close`. A socket that has sent anything
 * closes normally. So a never-used socket's close is observed as leaving OPEN.
 */
export async function leftOpen(desktop: RelayDesktop): Promise<void> {
  while (desktop.socket.readyState === WebSocket.OPEN) await settle(50);
}

export async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await settle(100);
  }

  throw new Error("Timed out");
}

export const WEB_ORIGINS = [
  "https://app.nyte.sh",
  "http://localhost:5179",
  "http://127.0.0.1:5179",
];

export const RELAY_EXPOSED = ["retry-after", "allow", ...RELAY_RESPONSE_HEADER_NAMES].join(", ");

export function expectCors(
  response: Response,
  origin: string,
  exposed = "retry-after, allow",
): void {
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("vary")?.toLowerCase().split(/,\s*/u)).toContain("origin");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("access-control-expose-headers")).toBe(exposed);
}
