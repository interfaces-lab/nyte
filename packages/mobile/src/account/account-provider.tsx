import { createContext, use, useRef } from "react";
import type { ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/expo";
import { releaseCopy } from "./account-copy.ts";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { tokenCache } from "@clerk/expo/token-cache";
import { fetch } from "expo/fetch";
import { BrokerError, createBrokerClient } from "@nyte-ai/connect";
import type { BrokerClient, EnvironmentSummary } from "@nyte-ai/connect";
import type { ManagedConnection } from "../connection/connection.ts";
import { connectionStore } from "../connection/host.ts";
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

export type AccountStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "signedOut" }
  | {
      readonly kind: "signedIn";
      readonly ownerId: string;
      readonly label: string;
      /** Signs every call with the owner's own session, or reports `signed_out`. */
      readonly broker: BrokerClient;
    };

export type SignInEnding =
  | { readonly kind: "signedIn" }
  | { readonly kind: "cancelled" }
  /** Clerk has not loaded, usually because this phone is offline. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

/** The Mac this account let go on the way out, and what it and the broker confirmed. */
type Released = { readonly name: string; readonly report: ReleaseReport };

export type SignOutEnding =
  | { readonly kind: "signedOut"; readonly released: Released | undefined }
  /** The Mac was let go, but Clerk would not end its session. */
  | { readonly kind: "clerkFailed"; readonly released: Released | undefined }
  /** The Keychain kept the connection, so nothing else was attempted. */
  | { readonly kind: "notRemoved" };

export interface Account {
  readonly status: AccountStatus;
  /**
   * The root cache, above every host's own. Account queries go here even from
   * a sheet under a connected Mac, so an account change clears them all.
   */
  readonly queryClient: QueryClient;
  readonly signIn: () => Promise<SignInEnding>;
  /**
   * End this phone's Clerk session and sign in again, for a session the broker
   * refused or a different account. The saved Mac stays unless another
   * account ends up signed in.
   */
  readonly renew: () => Promise<SignInEnding>;
  readonly signOut: () => Promise<SignOutEnding>;
  /**
   * Enroll with one of `ownerId`'s Macs. Refused unless that owner is still
   * the one signed in, so a list drawn for one account never enrolls under
   * another.
   */
  readonly connect: (input: {
    readonly ownerId: string;
    readonly environment: EnvironmentSummary;
    readonly signal: AbortSignal;
  }) => Promise<ConnectEnding>;
}

const AccountContext = createContext<Account | undefined>(undefined);

const config = readAccountConfig();

/** Undefined when this build has no account configuration: address and token only. */
export function useAccount(): Account | undefined {
  return use(AccountContext);
}

/**
 * Clerk sits above the connection gate, so switching Macs never restarts it,
 * and a build without account configuration never loads it at all.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  if (config === undefined) return children;

  return (
    <ClerkProvider publishableKey={config.publishableKey} tokenCache={tokenCache}>
      <AccountBridge config={config}>{children}</AccountBridge>
    </ClerkProvider>
  );
}

/** Runs `task` under one signal that aborts with any of `signals`. */
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

/** The account this phone acts for, and the signal that ends everything started for it. */
type Epoch = { readonly ownerId: string | null; readonly controller: AbortController };

function AccountBridge({ config, children }: { config: AccountConfig; children: ReactNode }) {
  const clerk = useClerk();
  const auth = useAuth();
  const { user } = useUser();
  const { startHostedAuth } = useHostedAuth();
  const queryClient = useQueryClient();
  const epoch = useRef<Epoch>(undefined);

  /**
   * A new owner (or none) aborts whatever the last one started and drops its
   * cached Macs, so nothing late can land under the wrong account. A signed-in
   * owner also lets go of any other account's Mac, however Clerk got there:
   * a sign-in, a switch, or a session restored at launch. Signing out alone
   * keeps the saved Mac, whose bearer outlives the session.
   */
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

  /**
   * The gate already refuses to serve another owner's Mac; this removes it and
   * releases its bearer on that Mac. Without that owner's session the broker
   * cannot be asked, so the release is the Mac's weak one.
   */
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

  // The live session, read at call time: a token for anyone but `ownerId` is never sent.
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
          broker: brokerFor(auth.userId),
        };

  async function signIn(): Promise<SignInEnding> {
    let created: string | null;

    try {
      // Ephemeral, so Safari keeps no portal session that could sign the
      // previous account back in after it signed out.
      created = (
        await startHostedAuth({
          mode: "sign-in",
          authSessionOptions: { preferEphemeralSession: true },
        })
      ).createdSessionId;
    } catch {
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
      const removed =
        ownerId === null
          ? undefined
          : await connectionStore.remove({
              match: (saved): saved is ManagedConnection =>
                saved.kind === "managed" && saved.binding.ownerId === ownerId,
              release: (saved) =>
                releaseDevice({
                  saved,
                  broker: saved.binding.origin === config.origin ? brokerFor(ownerId) : undefined,
                  fetch,
                  timeoutMs: RELEASE_TIMEOUT_MS,
                }),
            });

      released =
        removed === undefined
          ? undefined
          : { name: removed.saved.connection.name, report: removed.released };
    } catch {
      return { kind: "notRemoved" };
    }

    // A stale id is harmless: the next account checks its owner and makes its own.
    await forgetClientId().catch(() => undefined);

    try {
      await clerk.signOut();
    } catch {
      // Still signed in, so the account's own work may start again.
      enter(clerk.user?.id ?? null);

      return { kind: "clerkFailed", released };
    }

    return { kind: "signedOut", released };
  }

  async function connect({
    ownerId,
    environment,
    signal,
  }: Parameters<Account["connect"]>[0]): Promise<ConnectEnding> {
    if (clerk.user?.id !== ownerId) return { kind: "broker", failure: { kind: "signed_out" } };
    // The listener may not have run yet; entering the same owner again is a no-op.
    enter(ownerId);
    const current = epoch.current;

    if (current === undefined) return { kind: "broker", failure: { kind: "signed_out" } };

    // Ends on the user's cancel or on any account change, whichever comes first.
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
