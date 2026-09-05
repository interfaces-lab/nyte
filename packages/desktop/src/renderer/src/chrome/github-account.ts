/**
 * The GitHub account as the chrome sees it: one variant per thing the rail
 * footer or the Accounts panel has to say. Sign-in and sign-out progress
 * live here, not in main, so a variant can say "waiting for the browser".
 */
import { useState } from "react";
import type {
  GitHubAccount,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../../../shared/ipc.ts";
import { signInGitHub, signOutGitHub, useGitHubState } from "../queries.ts";

export type GitHubAccountViewModel =
  | { readonly kind: "loading" }
  | { readonly kind: "no_remote" }
  | { readonly kind: "cli_missing"; readonly repository: GitHubRepository }
  | {
      readonly kind: "signed_out";
      readonly repository: GitHubRepository;
      readonly signIn: () => void;
    }
  | { readonly kind: "connecting" }
  | {
      readonly kind: "signed_in";
      readonly account: GitHubAccount;
      readonly repository: GitHubRepository;
      readonly pullRequest: GitHubPullRequestContext;
      readonly signOut: () => void;
      readonly signingOut: boolean;
    }
  | {
      readonly kind: "error";
      readonly repository: GitHubRepository | undefined;
      readonly message: string;
    };

export function useGitHubAccount(enabled = true): GitHubAccountViewModel {
  const github = useGitHubState(enabled);
  const [connecting, setConnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (connecting) return { kind: "connecting" };
  if (github.data === undefined) return { kind: "loading" };

  switch (github.data.kind) {
    case "not_github":
      return { kind: "no_remote" };
    case "cli_missing":
      return { kind: "cli_missing", repository: github.data.repository };
    case "signed_out":
      return {
        kind: "signed_out",
        repository: github.data.repository,
        signIn: () => {
          setConnecting(true);
          void signInGitHub().finally(() => setConnecting(false));
        },
      };
    case "ready":
      return {
        kind: "signed_in",
        account: github.data.account,
        repository: github.data.repository,
        pullRequest: github.data.pullRequest,
        signingOut,
        signOut: () => {
          setSigningOut(true);
          void signOutGitHub().finally(() => setSigningOut(false));
        },
      };
    case "error":
      return { kind: "error", repository: github.data.repository, message: github.data.message };
    default: {
      const _exhaustive: never = github.data;
      return _exhaustive;
    }
  }
}
