import { relayAddress } from "@nyte-ai/connect";
import type { BrokerClient, EnvironmentSummary } from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import {
  awaitAcceptance,
  createDeviceSecret,
  READINESS,
  releaseOnHost,
  RELEASE_TIMEOUT_MS,
} from "@nyte-ai/connect/enrollment";
import type { DeviceRole } from "@nyte-ai/connect";
import { AcceptanceError } from "./account-copy.ts";
import {
  accountConnection,
  deviceCrypto,
  forgetAccountDevice,
  readAccountDevice,
  readClientId,
  saveAccountDevice,
} from "./account-device.ts";
import type { AccountDevice } from "./account-device.ts";
import { webBridge } from "./install.ts";
import { connectPinned } from "./pins.ts";
import type { PinRoute } from "./pins.ts";

export function accountRoute(
  device: Pick<AccountDevice, "origin" | "ownerId" | "environmentId">,
): PinRoute {
  return {
    kind: "account",
    origin: device.origin,
    ownerId: device.ownerId,
    environmentId: device.environmentId,
  };
}

export async function connectAccountEnvironment(input: {
  readonly broker: BrokerClient;
  readonly config: AccountConfig;
  readonly ownerId: string;
  readonly environment: EnvironmentSummary;
  readonly role: DeviceRole;
  readonly repair: boolean;
  readonly signal: AbortSignal;
}): Promise<AccountDevice | undefined> {
  const secret = await createDeviceSecret(deviceCrypto);

  if (input.signal.aborted) return undefined;

  const enrolled = await input.broker.enroll({
    environmentId: input.environment.id,
    request: {
      clientId: readClientId(sessionStorage, input.ownerId),
      clientName: "Web browser",
      digest: secret.digest,
      role: input.role,
    },
    signal: input.signal,
  });

  const device: AccountDevice = {
    origin: input.config.origin,
    ownerId: input.ownerId,
    environmentId: input.environment.id,
    deviceId: enrolled.deviceId,
    name: input.environment.name,
    token: secret.token,
    role: input.role,
  };

  const connection = {
    url: relayAddress(input.config.origin, device.environmentId),
    token: secret.token,
  };

  let kept = false;

  try {
    const acceptance = await awaitAcceptance({
      connection,
      fetch,
      signal: input.signal,
      readiness: READINESS,
    });

    if (acceptance === "cancelled" || input.signal.aborted) return undefined;

    if (acceptance !== "accepted") throw new AcceptanceError(acceptance);
    await connectPinned({
      bridge: webBridge,
      storage: localStorage,
      route: accountRoute(device),
      connection,
      repair: input.repair,
      options: {
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(READINESS.windowMs)]),
        relay: true,
      },
    });

    if (input.signal.aborted) return undefined;

    saveAccountDevice(sessionStorage, device);
    kept = true;

    return device;
  } finally {
    if (!kept) void releaseAccountDevice(device);
  }
}

export function releaseAccountDevice(device: AccountDevice): Promise<"removed" | "unconfirmed"> {
  return releaseOnHost({
    connection: accountConnection(device),
    fetch: (resource, init) => fetch(resource, { ...init, keepalive: true }),
    timeoutMs: RELEASE_TIMEOUT_MS,
  });
}

export async function revokeAccountDevice(
  device: AccountDevice,
  broker: BrokerClient,
): Promise<void> {
  try {
    await broker.revokeDevice({
      environmentId: device.environmentId,
      deviceId: device.deviceId,
      signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
    });
  } catch {}

  await releaseAccountDevice(device);
}

export async function releaseStoredAccountDevice(config: AccountConfig | undefined): Promise<void> {
  const device = config === undefined ? undefined : readAccountDevice(sessionStorage, config);
  forgetAccountDevice(sessionStorage);

  if (device !== undefined) await releaseAccountDevice(device);
}
