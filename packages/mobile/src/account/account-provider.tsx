import { createContext, use, useRef } from "react";
import type { ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ClerkProvider, isClerkAPIResponseError, useAuth, useClerk, useUser } from "@clerk/expo";
import { releaseCopy } from "./account-copy.ts";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { tokenCache } from "@clerk/expo/token-cache";
import { fetch } from "expo/fetch";
import { BrokerError, createBrokerClient } from "@nyte-ai/connect";
import type { BrokerClient, EnvironmentSummary } from "@nyte-ai/connect";
import type { ManagedConnection } from "../connection/connection.ts";
import { connectionStore, verifyHost } from "../connection/host.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { readAccountConfig, type AccountConfig } from "./account-config.ts";
import { CLIENT_NAME, deviceCrypto, forgetClientId, readClientId } from "./device.ts";
import { connectEnvironment, type ConnectEnding } from "./enrollment.ts";
import {
  RELEASE_TIMEOUT_MS,
  releaseDevice,
  releaseOnHost,
  type ReleaseReport,
} from "./revocation.ts";
import { toast } from "../ui/toast.tsx";

type AccountStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "signedOut" }
  | {
      readonly kind: "signedIn";
      readonly ownerId: string;
      readonly label: string;
      readonly avatarUrl: string | undefined;
      readonly broker: BrokerClient;
    };

export type SignInEnding =
  | { readonly kind: "signedIn" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "unregisteredApp" }
  | { readonly kind: "failed" };

type Released = { readonly name: string; readonly report: ReleaseReport };

export type SignOutEnding =
  | { readonly kind: "signedOut"; readonly released: Released | undefined }
  | { readonly kind: "clerkFailed"; readonly released: Released | undefined }
  | { readonly kind: "notRemoved" };

export interface Account {
  readonly status: AccountStatus;
  readonly queryClient: QueryClient;
  readonly signIn: () => Promise<SignInEnding>;
  readonly renew: () => Promise<SignInEnding>;
  readonly signOut: () => Promise<SignOutEnding>;
  readonly connect: (input: {
    readonly ownerId: string;
    readonly environment: EnvironmentSummary;
    readonly repair: boolean;
    readonly signal: AbortSignal;
  }) => Promise<ConnectEnding>;
}

const AccountContext = createContext<Account | undefined>(undefined);

const config = readAccountConfig();

export function useAccount(): Account | undefined {
  return use(AccountContext);
}

export function AccountProvider({ children }: { children: ReactNode }) {
  if (config === undefined) return children;

  return (
    <ClerkProvider publishableKey={config.publishableKey} tokenCache={tokenCache}>
      <AccountBridge config={config}>{children}</AccountBridge>
    </ClerkProvider>
  );
}

async function linked<T>(
  signals: readonly AbortSignal[],
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const stop = () => controller.abort();

  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", stop);
  }

  try {
    return await task(controller.signal);
  } finally {
    for (const signal of signals) signal.removeEventListener("abort", stop);
  }
}

async function forgetOwnedMac({
  ownerId,
  origin,
  brokerFor,
}: {
  ownerId: string | null;
  origin: string;
  brokerFor: (ownerId: string) => BrokerClient;
}): Promise<Released | undefined> {
  if (ownerId === null) return undefined;

  const removed = await connectionStore.remove({
    match: (saved): saved is ManagedConnection =>
      saved.kind === "managed" && saved.binding.ownerId === ownerId,
    release: (saved) =>
      releaseDevice({
        saved,
        broker: saved.binding.origin === origin ? brokerFor(ownerId) : undefined,
        fetch,
        timeoutMs: RELEASE_TIMEOUT_MS,
      }),
  });

  return removed === undefined
    ? undefined
    : { name: removed.saved.connection.name, report: removed.released };
}

type Epoch = { readonly ownerId: string | null; readonly controller: AbortController };

function AccountBridge({ config, children }: { config: AccountConfig; children: ReactNode }) {
  const clerk = useClerk();
  const auth = useAuth();
  const { user } = useUser();
  const { startHostedAuth } = useHostedAuth();
  const queryClient = useQueryClient();
  const epoch = useRef<Epoch>(undefined);

  function enter(ownerId: string | null) {
    if (epoch.current?.ownerId === ownerId) return;
    epoch.current?.controller.abort();
    epoch.current = { ownerId, controller: new AbortController() };
    queryClient.removeQueries({
      queryKey: ["account"],
      predicate: (query) => query.queryKey[1] !== ownerId,
    });

    if (ownerId !== null) void isolate(ownerId);
  }

  async function isolate(ownerId: string) {
    try {
      const removed = await connectionStore.remove({
        match: (saved): saved is ManagedConnection =>
          saved.kind === "managed" && saved.binding.ownerId !== ownerId,
        release: (saved) =>
          releaseOnHost({ connection: saved.connection, fetch, timeoutMs: RELEASE_TIMEOUT_MS }),
      });

      if (removed !== undefined)
        toast.show(
          "Switched accounts",
          releaseCopy(removed.saved.connection.name, { host: removed.released, broker: "skipped" }),
        );
    } catch {
      toast.error(
        "Couldn't forget the other account's Mac",
        "This iPhone won't use it. Unlock your phone, then sign in again to retry.",
      );
    }
  }

  useMountEffect(() =>
    clerk.addListener(({ user: next }) => {
      if (next !== undefined) enter(next?.id ?? null);
    }),
  );

  const brokerFor = (ownerId: string) =>
    createBrokerClient({
      origin: config.origin,
      fetch,
      sessionToken: async () => {
        const session = clerk.session;

        if (session == null || session.user?.id !== ownerId) return null;

        try {
          return await session.getToken({ skipCache: true });
        } catch {
          throw new BrokerError({ kind: "network" });
        }
      },
    });

  const status: AccountStatus = !auth.isLoaded
    ? { kind: "loading" }
    : !auth.isSignedIn
      ? { kind: "signedOut" }
      : {
          kind: "signedIn",
          ownerId: auth.userId,
          label:
            user?.primaryEmailAddress?.emailAddress ??
            user?.username ??
            user?.fullName ??
            "Nyte account",
          avatarUrl: user?.imageUrl,
          broker: brokerFor(auth.userId),
        };

  async function signIn(): Promise<SignInEnding> {
    let created: string | null;

    try {
      created = (
        await startHostedAuth({
          mode: "sign-in",
          authSessionOptions: { preferEphemeralSession: true },
        })
      ).createdSessionId;
    } catch (cause) {
      if (
        isClerkAPIResponseError(cause) &&
        cause.errors.some((error) => error.code === "resource_missmatch")
      )
        return { kind: "unregisteredApp" };

      return { kind: "failed" };
    }

    const ownerId = clerk.user?.id;

    if (created === null || ownerId === undefined)
      return { kind: clerk.loaded ? "cancelled" : "unavailable" };
    enter(ownerId);

    return { kind: "signedIn" };
  }

  async function renew(): Promise<SignInEnding> {
    try {
      await clerk.signOut();
    } catch {
      return { kind: "failed" };
    }

    return signIn();
  }

  async function signOut(): Promise<SignOutEnding> {
    const ownerId = clerk.user?.id ?? epoch.current?.ownerId ?? null;
    enter(null);
    let released: Released | undefined;

    try {
      released = await forgetOwnedMac({ ownerId, origin: config.origin, brokerFor });
    } catch {
      return { kind: "notRemoved" };
    }

    await forgetClientId().catch(() => undefined);

    try {
      await clerk.signOut();
    } catch {
      enter(clerk.user?.id ?? null);

      return { kind: "clerkFailed", released };
    }

    return { kind: "signedOut", released };
  }

  async function connect({
    ownerId,
    environment,
    repair,
    signal,
  }: Parameters<Account["connect"]>[0]): Promise<ConnectEnding> {
    if (clerk.user?.id !== ownerId) return { kind: "broker", failure: { kind: "signed_out" } };
    enter(ownerId);
    const current = epoch.current;

    if (current === undefined) return { kind: "broker", failure: { kind: "signed_out" } };

    return linked([signal, current.controller.signal], async (both) => {
      try {
        return await connectEnvironment({
          broker: brokerFor(ownerId),
          environment,
          origin: config.origin,
          ownerId,
          clientId: await readClientId(ownerId),
          clientName: CLIENT_NAME,
          crypto: deviceCrypto,
          fetch,
          verify: (saved, verifying) => verifyHost({ saved, repair, signal: verifying }),
          save: connectionStore.save,
          signal: both,
        });
      } catch (cause) {
        if (both.aborted) return { kind: "cancelled" };

        return {
          kind: "unexpected",
          detail: cause instanceof Error ? cause.message : String(cause),
        };
      }
    });
  }

  return (
    <AccountContext value={{ status, queryClient, signIn, renew, signOut, connect }}>
      {children}
    </AccountContext>
  );
}
