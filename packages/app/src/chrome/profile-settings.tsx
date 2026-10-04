/**
 * Settings › Profile: who you are to Nyte, in three groups that each read one
 * source. The Nyte account is an email address; GitHub is the CLI login with
 * the selected workspace's repository and pull request; this Mac is its name
 * and whether the account reaches it. Signing in or out of one never changes
 * what another shows.
 */
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { avatar, glyph, radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type {
  ConnectBridge,
  GitHubBridge,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { nyte } from "../nyte.ts";
import { useHostState } from "../queries.ts";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import {
  linkedStanding,
  unavailableDetail,
  useConnectAction,
  useConnectView,
} from "./connect-view.ts";
import { ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { signOutDescription, useGitHubAccount } from "./github-account.ts";
import { LinkTray } from "./link-tray.tsx";
import { DeviceCodePanel } from "./sign-in-panels.tsx";

const styles = create({
  page: { display: "flex", flexDirection: "column", gap: settings.cardGap },
  row: {
    position: "relative",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 12,
    rowGap: 8,
    padding: settings.rowPadding,
    "::before": {
      position: "absolute",
      insetInline: settings.rowPaddingInline,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
    ":first-child::before": { display: "none" },
  },
  glyph: { display: "grid", placeItems: "center", width: glyph.md, color: role.contentTertiary },
  copy: { display: "flex", flexDirection: "column", gap: 2, flex: "1 1 160px", minWidth: 0 },
  title: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  description: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  value: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  avatar: {
    display: "block",
    width: avatar.xs,
    height: avatar.xs,
    borderRadius: radius.pill,
    objectFit: "cover",
  },
  expansion: { flexBasis: "100%", minWidth: 0 },
});

function Row({
  title,
  description,
  glyph,
  value,
  control,
  expansion,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly glyph?: ReactNode;
  readonly value?: ReactNode;
  readonly control?: ReactNode;
  readonly expansion?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.row)}>
      {glyph !== undefined && <span {...props(styles.glyph)}>{glyph}</span>}
      <span {...props(styles.copy)}>
        <span {...props(styles.title)}>{title}</span>
        {description !== undefined && <span {...props(styles.description)}>{description}</span>}
      </span>
      {value !== undefined && <span {...props(styles.value)}>{value}</span>}
      {control}
      {expansion !== undefined && <div {...props(styles.expansion)}>{expansion}</div>}
    </div>
  );
}

function Group({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section aria-label={label} {...props(settingsPatterns.group)}>
      {children}
    </section>
  );
}

function openExternal(url: string): void {
  void nyte.host.openExternal({ url }).catch(() => undefined);
}

/** The Nyte account signed in on this Mac: an address, or the way to sign in. */
function AccountGroup({ connect }: { readonly connect: ConnectBridge }): ReactElement | null {
  const state = useConnectView(connect, true);
  const signIn = useConnectAction(() => connect.openAccount(), "Couldn’t sign in");
  const signOut = useConnectAction(() => connect.signOut(), "Couldn’t sign out");
  const view = state.data;

  if (view === undefined) {
    return (
      <Group label="Nyte account">
        <Row
          title="Nyte account"
          description={state.isError ? errorMessage(state.error) : "Checking…"}
        />
      </Group>
    );
  }

  if (view.kind === "unavailable") {
    return view.reason === "not_configured" ? null : (
      <Group label="Nyte account">
        <Row title="Nyte account" description={unavailableDetail(view.reason)} />
      </Group>
    );
  }

  const { account } = view;

  switch (account.kind) {
    case "unavailable":
      return null;
    case "signed_out":
      return (
        <Group label="Nyte account">
          <Row
            title="Nyte account"
            description="Reach this Mac from your iPhone."
            control={
              <Button variant="outline" loading={signIn.isPending} onClick={() => signIn.mutate()}>
                Sign In…
              </Button>
            }
          />
        </Group>
      );
    case "signed_in":
      return (
        <Group label="Nyte account">
          <Row
            title="Account"
            value={account.label}
            control={
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      iconOnly
                      icon="more-horizontal"
                      aria-label="Account options"
                      loading={signOut.isPending}
                    />
                  }
                />
                <MenuContent align="end">
                  <MenuItem onClick={() => signOut.mutate()}>Sign Out of Nyte</MenuItem>
                </MenuContent>
              </Menu>
            }
          />
        </Group>
      );
    default: {
      const _exhaustive: never = account;

      return _exhaustive;
    }
  }
}

function OpenOnGitHub({ url }: { readonly url: string }): ReactElement {
  return (
    <ButtonLink
      href={url}
      target="_blank"
      rel="noreferrer"
      variant="outline"
      onClick={(event) => {
        event.preventDefault();
        openExternal(url);
      }}
    >
      Open on GitHub
    </ButtonLink>
  );
}

function GitHubAccountRow({
  account: { query, auth, busy, connecting },
  refresh,
}: {
  readonly account: ReturnType<typeof useGitHubAccount>;
  readonly refresh: () => void;
}): ReactElement {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const web = nyte.clientSurface === "web";
  const state = query.data;

  if (connecting) {
    return (
      <Row
        title="GitHub"
        description="Signing in…"
        control={
          <Button variant="outline" loading>
            Sign In to GitHub
          </Button>
        }
      />
    );
  }

  if (query.isError || auth.isError || state?.kind === "error") {
    return (
      <Row
        title="GitHub"
        description={
          state?.kind === "error"
            ? state.message
            : auth.isError
              ? "Sign-in or sign-out failed. Run gh auth status in a terminal, then refresh."
              : "Couldn’t read the GitHub CLI's status."
        }
        control={
          <Button variant="outline" loading={query.isFetching} onClick={refresh}>
            Refresh
          </Button>
        }
      />
    );
  }

  if (state === undefined) return <Row title="GitHub" description="Checking…" />;

  switch (state.kind) {
    case "cli_missing":
      return (
        <Row
          title="GitHub"
          description={
            web
              ? "The GitHub CLI isn't installed on the machine running the server."
              : "The GitHub CLI isn't installed."
          }
          control={
            <ButtonLink
              href="https://cli.github.com"
              target="_blank"
              rel="noreferrer"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                openExternal("https://cli.github.com");
              }}
            >
              Install GitHub CLI
            </ButtonLink>
          }
        />
      );
    case "signed_out":
      return (
        <Row
          title="GitHub"
          description="Pull requests and repository links."
          control={
            <Button variant="outline" loading={busy} onClick={() => auth.mutate("signIn")}>
              Sign In to GitHub
            </Button>
          }
        />
      );
    case "signing_in":
      return (
        <Row
          title="GitHub"
          description="Waiting for approval on github.com"
          control={
            <Button variant="outline" loading={busy} onClick={() => auth.mutate("signOut")}>
              Cancel
            </Button>
          }
          expansion={<DeviceCodePanel deviceCode={state.deviceCode} message={undefined} />}
        />
      );
    case "ready": {
      const { login, avatarUrl } = state.account;

      return (
        <>
          <Row
            title="GitHub"
            value={
              <>
                {avatarUrl !== undefined && (
                  <img alt="" src={avatarUrl} {...props(styles.avatar)} />
                )}
                {login}
              </>
            }
            control={
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      ref={menuRef}
                      iconOnly
                      icon="more-horizontal"
                      aria-label="GitHub options"
                      loading={busy}
                    />
                  }
                />
                <MenuContent align="end">
                  <MenuItem onClick={() => openExternal(`https://github.com/${login}`)}>
                    Open Profile on GitHub
                  </MenuItem>
                  <MenuItem onClick={refresh}>Refresh</MenuItem>
                  <MenuSeparator />
                  <MenuItem variant="danger" onClick={() => setConfirmSignOut(true)}>
                    Sign Out of GitHub CLI…
                  </MenuItem>
                </MenuContent>
              </Menu>
            }
          />
          <ConfirmDialog
            open={confirmSignOut}
            pending={busy}
            finalFocus={menuRef}
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
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

function RepositoryRow({ repository }: { readonly repository: GitHubRepository }): ReactElement {
  return (
    <Row
      glyph={<Icon name="git" size={14} />}
      title={`${repository.owner}/${repository.name}`}
      description={`Remote ${repository.remoteName}`}
      control={<OpenOnGitHub url={repository.url} />}
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

function pullRequestState(pullRequest: GitHubPullRequest): string {
  switch (pullRequest.state) {
    case "OPEN":
      return pullRequest.draft ? "Draft" : "Open";
    case "MERGED":
      return "Merged";
    case "CLOSED":
      return "Closed";
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
  readonly context: GitHubPullRequestContext;
  readonly refresh: () => void;
}): ReactElement {
  switch (context.kind) {
    case "none":
      return (
        <Row
          glyph={<Icon name="pull-request" size={14} />}
          title="Pull request"
          description="None for the current branch"
        />
      );
    case "ready": {
      const { pullRequest } = context;

      return (
        <Row
          glyph={<Icon name={pullRequestIcon(pullRequest)} size={14} />}
          title={`#${pullRequest.number} ${pullRequest.title}`}
          description={`${pullRequestState(pullRequest)} · ${pullRequest.headRefName} → ${pullRequest.baseRefName}`}
          control={<OpenOnGitHub url={pullRequest.url} />}
        />
      );
    }

    case "error":
      return (
        <Row
          glyph={<Icon name="pull-request" size={14} />}
          title="Pull request"
          description={context.message}
          control={
            <Button variant="outline" onClick={refresh}>
              Refresh
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

/** The GitHub CLI login and what it reaches in the selected workspace. */
function GitHubGroup({ github }: { readonly github: GitHubBridge }): ReactElement {
  const account = useGitHubAccount(github);
  const state = account.query.data;
  const repository = state?.repository;

  const refresh = () => {
    account.auth.reset();
    void account.query.refetch();
  };

  return (
    <Group label="GitHub">
      <GitHubAccountRow account={account} refresh={refresh} />
      {repository !== undefined && <RepositoryRow repository={repository} />}
      {state?.kind === "ready" && repository !== undefined && (
        <PullRequestRow context={state.pullRequest} refresh={refresh} />
      )}
    </Group>
  );
}

/**
 * This Mac and whether the Nyte account reaches it. The link outlives a
 * sign-out, so this row never reads the session; the tray stays mounted until
 * it closes, even once the Mac is linked.
 */
function MacGroup({
  connect,
  onOpenEnvironments,
}: {
  readonly connect: ConnectBridge;
  readonly onOpenEnvironments: () => void;
}): ReactElement {
  const host = useHostState();
  const view = useConnectView(connect, true).data;
  const [trayOpen, setTrayOpen] = useState(false);
  const name = host.data?.machineName ?? "This Mac";

  const environments = (
    <Button variant="ghost" onClick={onOpenEnvironments}>
      Environments
      <Icon name="chevron-right" size={12} />
    </Button>
  );

  const macGlyph = <Icon name="laptop" size={16} />;

  if (view === undefined || view.kind === "unavailable") {
    return (
      <Group label="This Mac">
        <ConnectionRow glyph={macGlyph} title={name} control={environments} />
      </Group>
    );
  }

  if (view.kind === "linked" && !trayOpen) {
    const { tone, status } = linkedStanding(view);

    return (
      <Group label="This Mac">
        <ConnectionRow
          glyph={macGlyph}
          title={name}
          detail={
            <>
              <ConnectionStatus tone={tone}>{status}</ConnectionStatus>
              {` · ${view.owner.label}`}
            </>
          }
          control={environments}
        />
      </Group>
    );
  }

  return (
    <Group label="This Mac">
      <ConnectionRow
        glyph={macGlyph}
        title={name}
        detail="Not linked to a Nyte account."
        control={
          <LinkTray
            connect={connect}
            open={trayOpen}
            onOpenChange={setTrayOpen}
            side="bottom"
            trigger={<Button variant="outline">Link This Mac…</Button>}
          />
        }
      />
    </Group>
  );
}

export function ProfileSettings({
  onOpenEnvironments,
}: {
  readonly onOpenEnvironments: () => void;
}): ReactElement {
  const { github } = nyte.host;
  const desktop = nyte.clientSurface === "desktop";

  return (
    <div {...props(styles.page)}>
      {desktop && <AccountGroup connect={nyte.host.connect} />}
      {github !== undefined && <GitHubGroup github={github} />}
      {desktop && <MacGroup connect={nyte.host.connect} onOpenEnvironments={onOpenEnvironments} />}
    </div>
  );
}
