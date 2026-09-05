/**
 * Settings › Accounts: the GitHub connection for this project as one card.
 * The account row says whether it is connected and offers the single action
 * that changes that; the rows under it show what the connection reaches, the
 * repository and the current branch's pull request. Model providers live
 * under Settings › Models with their models.
 */
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type {
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../../../shared/ipc.ts";
import { Icon, type IconName } from "../components/icons.tsx";
import { Button } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { refreshGitHub } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus as Status } from "./connection-list.tsx";
import { useGitHubAccount, type GitHubAccountViewModel } from "./github-account.ts";

const styles = stylex.create({
  avatar: {
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: t.radiusFull,
    objectFit: "cover",
  },
});

function openOnGitHub(url: string): void {
  void nyte.host.openExternal({ url }).catch(() => undefined);
}

function OpenOnGitHub({ url }: { url: string }): ReactElement {
  return (
    <Button variant="ghost" icon="github" onClick={() => openOnGitHub(url)}>
      Open on GitHub
    </Button>
  );
}

function AccountRow({ account }: { account: GitHubAccountViewModel }): ReactElement {
  const glyph = <Icon name="github" size={15} />;
  switch (account.kind) {
    case "loading":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail={undefined}
          status={<Status tone="off">…</Status>}
        />
      );
    case "no_remote":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="This project has no GitHub remote"
          status={<Status tone="off">Not connected</Status>}
        />
      );
    case "cli_missing":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="Install the GitHub CLI (gh) to sign in"
          status={<Status tone="off">Not connected</Status>}
        />
      );
    case "signed_out":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="Sign in to see this branch's pull request"
          status={<Status tone="off">Not connected</Status>}
          actions={<Button onClick={account.signIn}>Sign in</Button>}
        />
      );
    case "connecting":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail="Finish signing in with the browser window that opened"
          status={<Status tone="warn">Waiting for browser</Status>}
        />
      );
    case "signed_in": {
      const { login, name, avatarUrl } = account.account;
      return (
        <ConnectionRow
          glyph={
            avatarUrl === undefined ? (
              glyph
            ) : (
              <img alt="" src={avatarUrl} {...stylex.props(styles.avatar)} />
            )
          }
          title={name ?? login}
          detail={`@${login}`}
          status={<Status tone="on">Connected</Status>}
          actions={
            <Button variant="ghost" disabled={account.signingOut} onClick={account.signOut}>
              Sign out
            </Button>
          }
        />
      );
    }
    case "error":
      return (
        <ConnectionRow
          glyph={glyph}
          title="GitHub"
          detail={account.message}
          status={<Status tone="err">Unavailable</Status>}
          actions={<Button onClick={() => void refreshGitHub()}>Try again</Button>}
        />
      );
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
        <Status tone="off">Draft</Status>
      ) : (
        <Status tone="on">Open</Status>
      );
    case "MERGED":
      return <Status tone="off">Merged</Status>;
    case "CLOSED":
      return <Status tone="off">Closed</Status>;
    default: {
      const _exhaustive: never = pullRequest.state;
      return _exhaustive;
    }
  }
}

function PullRequestRow({ context }: { context: GitHubPullRequestContext }): ReactElement {
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
          status={<Status tone="err">Unavailable</Status>}
          actions={
            <Button variant="ghost" onClick={() => void refreshGitHub()}>
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

/** The repository is known before sign-in; the card shows it so signing in has a visible object. */
function repositoryOf(account: GitHubAccountViewModel): GitHubRepository | undefined {
  switch (account.kind) {
    case "cli_missing":
    case "signed_out":
    case "signed_in":
    case "error":
      return account.repository;
    case "loading":
    case "no_remote":
    case "connecting":
      return undefined;
    default: {
      const _exhaustive: never = account;
      return _exhaustive;
    }
  }
}

export function AccountsSettings(): ReactElement {
  const account = useGitHubAccount();
  const repository = repositoryOf(account);

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>GitHub</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          Signs in through the GitHub CLI. Nyte never sees the token. Optional; local Git works
          without it.
        </p>
      </div>
      <ConnectionList>
        <AccountRow account={account} />
        {repository !== undefined && <RepositoryRow repository={repository} />}
        {account.kind === "signed_in" && <PullRequestRow context={account.pullRequest} />}
      </ConnectionList>
    </section>
  );
}
