import { shape } from "@nyte-ai/ui/schema.stylex";
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
  GitHubBridge,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../bridge.ts";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { nyte } from "../nyte.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";

import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { signOutDescription, useGitHubAccount } from "./github-account.ts";
import { DeviceCodePanel } from "./sign-in-panels.tsx";

const styles = create({
  avatar: {
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: shape.pill,
    objectFit: "cover",
  },
});

function OpenOnGitHub({ url }: { url: string }): ReactElement {
  return (
    <ButtonLink
      href={url}
      target="_blank"
      rel="noreferrer"
      icon="github"
      onClick={(event) => {
        event.preventDefault();
        void nyte.host.openExternal({ url }).catch(() => undefined);
      }}
    >
      Open on GitHub
    </ButtonLink>
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
  const web = nyte.clientSurface === "web";

  if (connecting) {
    return (
      <ConnectionRow
        glyph={glyph}
        title="GitHub"
        detail={undefined}
        status={<ConnectionStatus tone="warn">Signing in…</ConnectionStatus>}
        actions={
          <Button variant="outline" loading>
            Sign In to GitHub
          </Button>
        }
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
              : "Failed to read GitHub status. Refresh GitHub."
        }
        status={<ConnectionStatus tone="err">Unavailable</ConnectionStatus>}
        actions={
          <Button
            variant="outline"
            loading={query.isFetching}
            onClick={() => {
              auth.reset();
              void query.refetch();
            }}
          >
            Refresh GitHub
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
          detail={
            web
              ? "Install the GitHub CLI on the machine running the server, then refresh."
              : "Install the GitHub CLI, then refresh."
          }
          status={<ConnectionStatus tone="off">CLI not found</ConnectionStatus>}
          actions={
            <ButtonLink
              href={"https://cli.github.com"}
              target="_blank"
              rel="noreferrer"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                void nyte.host
                  .openExternal({ url: "https://cli.github.com" })
                  .catch(() => undefined);
              }}
            >
              Install GitHub CLI
            </ButtonLink>
          }
        />
      );
    case "signed_out":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail={undefined}
          status={<ConnectionStatus tone="off">Not connected</ConnectionStatus>}
          actions={
            <Button variant="outline" loading={busy} onClick={() => auth.mutate("signIn")}>
              Sign In to GitHub
            </Button>
          }
        />
      );
    case "signing_in":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail={undefined}
          status={<ConnectionStatus tone="warn">Waiting for approval</ConnectionStatus>}
          actions={
            <Button loading={busy} onClick={() => auth.mutate("signOut")}>
              Cancel
            </Button>
          }
          expansion={<DeviceCodePanel deviceCode={account.deviceCode} message={undefined} />}
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
              <Button ref={signOutRef} loading={busy} onClick={() => setConfirmSignOut(true)}>
                Sign Out of GitHub CLI…
              </Button>
            }
          />
          <ConfirmDialog
            open={confirmSignOut}
            pending={busy}
            error={undefined}
            returnFocusRef={signOutRef}
            title="Sign Out of GitHub CLI"
            description={signOutDescription(login)}
            confirmLabel="Sign Out of GitHub CLI"
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
          actions={<Button onClick={refresh}>Refresh GitHub</Button>}
        />
      );
    default: {
      const _exhaustive: never = context;

      return _exhaustive;
    }
  }
}

/** Settings lists this section only where the host has GitHub. */
export function AccountsSettings(): ReactElement | null {
  const github = nyte.host.github;

  return github === undefined ? null : <GitHubSettings github={github} />;
}

function GitHubSettings({ github }: { github: GitHubBridge }): ReactElement {
  const account = useGitHubAccount(github);
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
          {nyte.clientSurface === "web"
            ? "Uses the GitHub CLI account on the machine running the server. Git works without it."
            : "Uses your GitHub CLI account. Local Git works without it."}
        </p>
      </div>
      <ConnectionList>
        <AccountRow {...account} />
        {repository !== undefined && <RepositoryRow repository={repository} />}
        {state?.kind === "ready" && repository !== undefined && (
          <PullRequestRow context={state.pullRequest} refresh={refresh} />
        )}
      </ConnectionList>
      <Button loading={account.query.isFetching} disabled={account.busy} onClick={refresh}>
        Refresh GitHub
      </Button>
    </section>
  );
}
