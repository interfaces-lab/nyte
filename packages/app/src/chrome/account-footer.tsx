/**
 * The sidebar footer's account row. Its label is the GitHub CLI login, or this
 * Mac's name without one; it never shows the Nyte account. The menu lists each
 * account in its own group, each read by its own component, so signing in or
 * out of one never changes how the other reads. Signing out lives in Profile.
 */
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { ConnectBridge, GitHubBridge } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { useHostState } from "../queries.ts";
import { useConnectAction, useConnectView } from "./connect-view.ts";
import { useGitHubAccount } from "./github-account.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";

const REPORT_ISSUE_URL = "https://github.com/interfaces-lab/nyte/issues/new";

const INSTALL_GITHUB_CLI_URL = "https://cli.github.com";

function openExternal(url: string): void {
  void nyte.host.openExternal({ url }).catch(() => undefined);
}

/** The GitHub CLI's item: who is signed in, or the one step that gets there. */
function GitHubGroup({
  account: { query, auth, busy },
  onOpenProfile,
}: {
  readonly account: ReturnType<typeof useGitHubAccount>;
  readonly onOpenProfile: () => void;
}): ReactElement {
  const state = query.data;

  const item = (label: string, onClick: () => void) => (
    <MenuItem icon="github" disabled={busy} xstyle={styles.accountMenuItem} onClick={onClick}>
      {label}
    </MenuItem>
  );

  return (
    <MenuGroup>
      <MenuGroupLabel>GitHub</MenuGroupLabel>
      {state?.kind === "ready"
        ? item(state.account.login, onOpenProfile)
        : state?.kind === "signed_out"
          ? item("Sign In to GitHub…", () => {
              // Profile shows the device code the sign-in waits on.
              auth.mutate("signIn");
              onOpenProfile();
            })
          : state?.kind === "cli_missing"
            ? item("Install GitHub CLI", () => openExternal(INSTALL_GITHUB_CLI_URL))
            : state?.kind === "signing_in"
              ? item("Finish GitHub Sign-In…", onOpenProfile)
              : item("GitHub…", onOpenProfile)}
    </MenuGroup>
  );
}

/** The Nyte account's item: its address, or Sign In. Absent where accounts are unavailable. */
function NyteGroup({
  connect,
  onOpenProfile,
}: {
  readonly connect: ConnectBridge;
  readonly onOpenProfile: () => void;
}): ReactElement | null {
  const view = useConnectView(connect, true).data;
  const signIn = useConnectAction(() => connect.openAccount(), "Couldn’t sign in");

  if (view === undefined || view.kind === "unavailable" || view.account.kind === "unavailable")
    return null;

  const { account } = view;

  return (
    <MenuGroup>
      <MenuGroupLabel>Nyte account</MenuGroupLabel>
      {account.kind === "signed_in" ? (
        <MenuItem icon="user" xstyle={styles.accountMenuItem} onClick={onOpenProfile}>
          {account.label}
        </MenuItem>
      ) : (
        <MenuItem
          icon="user"
          disabled={signIn.isPending}
          xstyle={styles.accountMenuItem}
          onClick={() => signIn.mutate()}
        >
          Sign In to Nyte…
        </MenuItem>
      )}
    </MenuGroup>
  );
}

export function AccountFooterMenu({
  github,
  connect,
  anchor,
  onOpenProfile,
}: {
  readonly github: GitHubBridge;
  readonly connect: ConnectBridge;
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly onOpenProfile: () => void;
}): ReactElement {
  const host = useHostState();
  const account = useGitHubAccount(github);
  // A workspace switch reads GitHub afresh; the label keeps the last answer meanwhile.
  const [last, setLast] = useState(account.query.data);

  if (account.query.data !== undefined && account.query.data !== last) setLast(account.query.data);

  const state = account.query.data ?? last;
  const signedIn = state?.kind === "ready" ? state.account : undefined;

  return (
    <Menu highlightItemOnHover={false}>
      <MenuTrigger
        render={
          <Row
            variant="nav"
            aria-busy={account.busy || undefined}
            xstyle={[styles.navRow, styles.accountButton]}
          >
            <Row.Leading xstyle={styles.avatarSlot}>
              {signedIn?.avatarUrl !== undefined ? (
                <img alt="" src={signedIn.avatarUrl} {...props(styles.avatar)} />
              ) : (
                <Icon name={signedIn === undefined ? "laptop" : "user"} size={14} />
              )}
            </Row.Leading>
            <Row.Label>{signedIn?.login ?? host.data?.machineName ?? "Profile"}</Row.Label>
          </Row>
        }
      />
      <MenuContent side="top" align="start" anchor={anchor} sideOffset={4} matchAnchorWidth>
        <GitHubGroup account={account} onOpenProfile={onOpenProfile} />
        <NyteGroup connect={connect} onOpenProfile={onOpenProfile} />
        <MenuSeparator inset />
        <MenuItem
          icon="bubble-question"
          xstyle={styles.accountMenuItem}
          onClick={() => openExternal(REPORT_ISSUE_URL)}
        >
          Report Issue
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
