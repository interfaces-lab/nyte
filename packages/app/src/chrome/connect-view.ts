/**
 * Remote access through the Nyte account, as the renderer reads it: one query,
 * the actions that change it, and the words for where it stands. The account
 * session and this Mac's link have separate lifetimes, so each surface reads
 * the part it shows and nothing else.
 */
import { toast } from "@nyte-ai/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConnectBridge,
  ConnectLinkFailure,
  ConnectNotice,
  ConnectUnavailable,
  ConnectView,
} from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { keys } from "../queries.ts";
import type { ConnectionStanding } from "./connection-list.tsx";

export type LinkedView = Extract<ConnectView, { kind: "linked" }>;

export interface LinkedStanding extends ConnectionStanding {
  readonly note: string | undefined;
}

export function useConnectView(connect: ConnectBridge, active: boolean) {
  return useQuery({
    queryKey: keys.connect,
    queryFn: () => connect.state(),
    enabled: active,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
}

export function useConnectAction<TInput = void, TResult = void>(
  act: (input: TInput) => Promise<TResult>,
  failure: string,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: act,
    onError: (cause) =>
      toast.add({ type: "error", title: `${failure}: ${errorMessage(cause)}`, id: "nyte-account" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.connect }),
  });
}

export function unavailableDetail(reason: ConnectUnavailable): string {
  switch (reason) {
    case "not_configured":
      return "This build of Nyte isn’t set up for Nyte accounts.";
    case "store_failed":
      return "Nyte can’t use ~/.nyte/connect.json. Remote access is off.";
    case "origin_changed":
      return "This Mac is linked through a different Nyte service than this build uses. Unlink it first.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

export function noticeNote(notice: ConnectNotice): string | undefined {
  switch (notice.kind) {
    case "none":
      return undefined;
    case "revoked":
      return "This Mac was removed from your Nyte account.";
    case "unlink_pending":
      return "Unlinked. Your account lists this Mac until Nyte reaches it.";
    default: {
      const _exhaustive: never = notice;

      return _exhaustive;
    }
  }
}

export function linkFailure(reason: ConnectLinkFailure): string | undefined {
  switch (reason) {
    case "cancelled":
      return undefined;
    case "network":
      return "Couldn’t reach Nyte. Check your internet connection, then try again.";
    case "limit":
      return "This account can’t link another Mac right now. Try again later, or unlink a Mac you no longer use.";
    case "owner_disabled":
      return "This Nyte account is locked or disabled, so it can’t link Macs.";
    case "session_revoked":
      return "Your sign-in was revoked. Sign in again, then link this Mac.";
    case "denied":
      return "The link request was declined.";
    case "expired":
      return "The link request expired before it was approved.";
    case "refused":
      return "Nyte refused to link this Mac.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

/**
 * Only a current lease admits devices, so nothing short of one reads as
 * reachable, however connected the relay is.
 */
export function linkedStanding(view: LinkedView): LinkedStanding {
  if (!view.enabled) return { tone: "off", status: "Off", note: undefined };

  if (view.connection.kind === "failed") {
    return {
      tone: "err",
      status: "Not reachable",
      note: "Another Nyte connection replaced this Mac. Turn remote access off, then on again.",
    };
  }

  switch (view.lease.kind) {
    case "stopped":
      return { tone: "off", status: "Stopped", note: undefined };
    case "pending":
      return { tone: "warn", status: "Verifying…", note: undefined };
    case "lapsed":
      return view.lease.reason === "owner_disabled"
        ? {
            tone: "err",
            status: "Account disabled",
            note: `${view.owner.label} is locked or disabled, so devices are refused.`,
          }
        : {
            tone: "warn",
            status: "Offline",
            note: "Nyte can’t reach your account to verify this Mac, so devices are refused until it does.",
          };
    case "current":
      switch (view.connection.kind) {
        case "stopped":
          return { tone: "off", status: "Stopped", note: undefined };
        case "connecting":
          return { tone: "warn", status: "Connecting…", note: undefined };
        case "retrying":
          return { tone: "warn", status: "Reconnecting…", note: undefined };
        case "connected":
          return { tone: "on", status: "Reachable", note: undefined };
        default: {
          const _exhaustive: never = view.connection;

          return _exhaustive;
        }
      }

    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}
