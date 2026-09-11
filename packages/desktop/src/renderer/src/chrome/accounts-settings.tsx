/**
 * Settings › Accounts: the shared GitHub CLI account and the selected repository.
 * The account row says whether it is connected and offers the single action
 * that changes that; the rows under it show what the connection reaches, the
 * repository and the current branch's pull request. Model providers live
 * under Settings › Models with their models.
 */
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../../../shared/ipc.ts";
import { Icon, type IconName } from "../components/icons.tsx";
import { Button } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { useGitHubAccount } from "./github-account.ts";

const styles = create({
  avatar: {
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: t.radiusFull,
    objectFit: "cover",
  },
});

function OpenOnGitHub({ url }: { url: string }): ReactElement {
  return (
    <Button
      variant="ghost"
      icon="github"
      onClick={() => void nyte.host.openExternal({ url }).catch(() => undefined)}
    >
      Open on GitHub
    </Button>
  );
}

function AccountRow({
  query,
  auth,
  busy,
  connecting,
}: ReturnType<typeof useGitHubAccount>): ReactElement {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const glyph = <Icon name="github" size={15} />;
  if (connecting) {
    return (
      <ConnectionRow
        glyph={glyph}
        title="GitHub"
        detail="When GitHub opens, paste the one-time code copied by the CLI. If no browser opens, run gh auth login in a terminal."
        status={<ConnectionStatus tone="warn">Signing in…</ConnectionStatus>}
      />
    );
  }
  if (query.isError || auth.isError || query.data?.kind === "error") {
    return (
      <ConnectionRow
        glyph={glyph}
        title="GitHub"
        detail={
          query.data?.kind === "error"
            ? query.data.message
            : auth.isError
              ? "GitHub sign-in or sign-out failed. Run gh auth status in a terminal, then refresh."
              : "Failed to read GitHub status. Try again."
        }
        status={<ConnectionStatus tone="err">Unavailable</ConnectionStatus>}
        actions={
          <Button
            disabled={query.isFetching}
            onClick={() => {
              auth.reset();
              void query.refetch();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  const account = query.data;
  if (account === undefined) {
    return (
      <ConnectionRow
        glyph={glyph}
        title="GitHub"
        detail={undefined}
        status={<ConnectionStatus tone="off">Checking GitHub…</ConnectionStatus>}
      />
    );
  }
  switch (account.kind) {
    case "cli_missing":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="Install the GitHub CLI, then refresh."
          status={<ConnectionStatus tone="off">CLI not found</ConnectionStatus>}
          actions={
            <Button
              onClick={() =>
                void nyte.host
                  .openExternal({ url: "https://cli.github.com" })
                  .catch(() => undefined)
              }
            >
              Install GitHub CLI
            </Button>
          }
        />
      );
    case "signed_out":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="Sign in through the browser. The CLI copies a one-time code to your clipboard."
          status={<ConnectionStatus tone="off">Not connected</ConnectionStatus>}
          actions={
            <Button disabled={busy} onClick={() => auth.mutate("signIn")}>
              Sign in
            </Button>
          }
        />
      );
    case "ready": {
      const { login, name, avatarUrl } = account.account;
      return (
        <>
          <ConnectionRow
            glyph={
              avatarUrl === undefined ? (
                glyph
              ) : (
                <img alt="" src={avatarUrl} {...props(styles.avatar)} />
              )
            }
            title={name ?? login}
            detail={`@${login}`}
            status={<ConnectionStatus tone="on">Connected</ConnectionStatus>}
            actions={
              <Button
                ref={signOutRef}
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmSignOut(true)}
              >
                Sign out
              </Button>
            }
          />
          <ConfirmDialog
            open={confirmSignOut}
            pending={busy}
            error={undefined}
            returnFocusRef={signOutRef}
            title="Sign out of GitHub CLI?"
            description={`This removes the CLI login for @${login} on github.com. Terminal commands and other apps using this login will also be signed out.`}
            confirmLabel="Sign out"
            pendingLabel="Signing out…"
            onOpenChange={setConfirmSignOut}
            onConfirm={() => auth.mutate("signOut", { onSuccess: () => setConfirmSignOut(false) })}
          />
        </>
      );
    }
    default: {
      const _exhaustive: never = account;
      return _exhaustive;
    }
  }
}

function RepositoryRow({ repository }: { repository: GitHubRepository }): ReactElement {
  return (
    <ConnectionRow
      glyph={<Icon name="git" size={15} />}
      title={`${repository.owner}/${repository.name}`}
      detail={`Remote ${repository.remoteName}`}
      actions={<OpenOnGitHub url={repository.url} />}
    />
  );
}

function pullRequestIcon(pullRequest: GitHubPullRequest): IconName {
  switch (pullRequest.state) {
    case "OPEN":
      return pullRequest.draft ? "draft" : "pull-request";
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "pull-request-closed";
    default: {
      const _exhaustive: never = pullRequest.state;
      return _exhaustive;
    }
  }
}

function pullRequestStatus(pullRequest: GitHubPullRequest): ReactElement {
  switch (pullRequest.state) {
    case "OPEN":
      return pullRequest.draft ? (
        <ConnectionStatus tone="off">Draft</ConnectionStatus>
      ) : (
        <ConnectionStatus tone="on">Open</ConnectionStatus>
      );
    case "MERGED":
      return <ConnectionStatus tone="off">Merged</ConnectionStatus>;
    case "CLOSED":
      return <ConnectionStatus tone="off">Closed</ConnectionStatus>;
    default: {
      const _exhaustive: never = pullRequest.state;
      return _exhaustive;
    }
  }
}

function PullRequestRow({
  context,
  refresh,
}: {
  context: GitHubPullRequestContext;
  refresh: () => void;
}): ReactElement {
  switch (context.kind) {
    case "none":
      return (
        <ConnectionRow
          glyph={<Icon name="pull-request" size={15} />}
          title="Pull request"
          detail="None for the current branch"
        />
      );
    case "ready": {
      const { pullRequest } = context;
      return (
        <ConnectionRow
          glyph={<Icon name={pullRequestIcon(pullRequest)} size={15} />}
          title={`#${pullRequest.number} ${pullRequest.title}`}
          detail={`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}
          status={pullRequestStatus(pullRequest)}
          actions={<OpenOnGitHub url={pullRequest.url} />}
        />
      );
    }
    case "error":
      return (
        <ConnectionRow
          glyph={<Icon name="pull-request" size={15} />}
          title="Pull request"
          detail={context.message}
          status={<ConnectionStatus tone="err">Unavailable</ConnectionStatus>}
          actions={
            <Button variant="ghost" onClick={refresh}>
              Try again
            </Button>
          }
        />
      );
    default: {
      const _exhaustive: never = context;
      return _exhaustive;
    }
  }
}

export function AccountsSettings(): ReactElement {
  const account = useGitHubAccount();
  const state = account.query.data;
  const repository = state?.repository;
  const refresh = () => {
    account.auth.reset();
    void account.query.refetch();
  };

  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>GitHub</h2>
        <p {...props(settingsPatterns.sectionDescription)}>
          Uses your GitHub CLI account. Local Git works without it.
        </p>
      </div>
      <ConnectionList>
        <AccountRow {...account} />
        {repository !== undefined && <RepositoryRow repository={repository} />}
        {state?.kind === "ready" && repository !== undefined && (
          <PullRequestRow context={state.pullRequest} refresh={refresh} />
        )}
      </ConnectionList>
      <Button variant="ghost" disabled={account.query.isFetching || account.busy} onClick={refresh}>
        {account.query.isFetching ? "Refreshing…" : "Refresh GitHub"}
      </Button>
    </section>
  );
}
