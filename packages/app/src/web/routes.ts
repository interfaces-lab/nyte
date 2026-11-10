import type { HostId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { useSyncExternalStore } from "react";
import { currentLive, subscribeLive } from "../data/connection.ts";
import { hostWatch } from "../data/watches.ts";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";

const HOLD_MS = 30 * 60_000;

const UNHEALTHY_MS = 20_000;

const StoredRoute = Type.Object(
  { url: Type.String({ minLength: 1 }), heldUntil: Type.Number() },
  { additionalProperties: false },
);

type LocalNetwork = "granted" | "prompt" | "denied" | "ungated";

interface PermissionQuery {
  query(descriptor: { readonly name: string }): Promise<PermissionStatus>;
}

export interface RouteState {
  readonly direct: boolean;
  readonly offer: string | undefined;
}

let state: RouteState = { direct: false, offer: undefined };

const listeners = new Set<() => void>();

function publish(next: RouteState): void {
  if (next.direct === state.direct && next.offer === state.offer) return;
  state = next;

  for (const listener of listeners) listener();
}

function routeKey(hostId: HostId): string {
  return `nyte:route:${hostId}`;
}

function readRoute(hostId: HostId) {
  return readStored(localArea(), routeKey(hostId), StoredRoute, undefined);
}

export function holdRoute(hostId: HostId): void {
  const stored = readRoute(hostId);

  if (stored !== undefined)
    writeStored(localArea(), routeKey(hostId), { ...stored, heldUntil: Date.now() + HOLD_MS });
}

export async function directRoute(hostId: HostId): Promise<string | undefined> {
  const stored = readRoute(hostId);

  if (stored === undefined || stored.heldUntil > Date.now()) return undefined;
  const permission = await localNetworkPermission();

  return permission === "granted" || permission === "ungated" ? stored.url : undefined;
}

export function noteDirect(direct: boolean): void {
  publish({ ...state, direct });
}

export function useRouteState(): RouteState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function followRoutes(hostId: HostId): void {
  const watch = hostWatch("host");

  const remember = (): void => {
    const routes = watch.getState().value?.routes;

    if (routes === undefined) return;
    const url = routes.find((route) => route.kind === "tailnet")?.url;
    const stored = readRoute(hostId);

    if (url === undefined) removeStored(localArea(), routeKey(hostId));
    else if (stored?.url !== url) writeStored(localArea(), routeKey(hostId), { url, heldUntil: 0 });

    void offer();
  };

  const offer = async (): Promise<void> => {
    const stored = readRoute(hostId);

    const offered =
      !state.direct &&
      stored !== undefined &&
      stored.heldUntil <= Date.now() &&
      (await localNetworkPermission()) === "prompt"
        ? stored.url
        : undefined;

    publish({ ...state, offer: offered });
  };

  let unhealthy: ReturnType<typeof setTimeout> | undefined;
  let leaveHealth: (() => void) | undefined;

  const checkHealth = (): void => {
    const health = currentLive()?.health.snapshot();

    if (!state.direct || health?.kind === "open") {
      clearTimeout(unhealthy);
      unhealthy = undefined;

      return;
    }

    unhealthy ??= setTimeout(() => {
      holdRoute(hostId);
      location.reload();
    }, UNHEALTHY_MS);
  };

  const followLive = (): void => {
    leaveHealth?.();
    leaveHealth = currentLive()?.health.subscribe(checkHealth);
    checkHealth();
  };

  watch.subscribe(remember);
  subscribeLive(followLive);
  followLive();
  remember();
}

export async function connectDirectly(url: string): Promise<boolean> {
  const answered = await fetch(`${url}/.nyte/describe`, { credentials: "omit" }).then(
    () => true,
    () => false,
  );

  if (answered) location.reload();

  return answered;
}

async function localNetworkPermission(): Promise<LocalNetwork> {
  const permissions: PermissionQuery = navigator.permissions;

  for (const name of ["local-network", "local-network-access"]) {
    const status = await permissions.query({ name }).catch(() => undefined);

    if (status !== undefined) return status.state;
  }

  return "ungated";
}
