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
import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { GitHubAccountState } from "@nyte-ai/sdk";
import type { ReactElement, RefObject } from "react";
import type { ConnectBridge } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { openExternal } from "../open-external.ts";
import { useUpdateState } from "../queries.ts";
import { updateLabel } from "../updates.ts";
import { useConnectAction, useConnectView } from "./connect-view.ts";
import { useGitHubAuth } from "./github-account.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";

const FEEDBACK_URL = "https://github.com/interfaces-lab/nyte/issues/new/choose";

const INSTALL_GITHUB_CLI_URL = "https://cli.github.com";

function GitHubGroup({
  state,
  github: { auth, busy },
  onOpenProfile,
}: {
  readonly state: GitHubAccountState;
  readonly github: ReturnType<typeof useGitHubAuth>;
  readonly onOpenProfile: () => void;
}): ReactElement {
  const item = (label: string, onClick: () => void) => (
    <MenuItem icon="github" disabled={busy} variant="quiet" onClick={onClick}>
      {label}
    </MenuItem>
  );

  return (
    <MenuGroup>
      <MenuGroupLabel>GitHub</MenuGroupLabel>
      {state.kind === "ready"
        ? item(state.account.login, onOpenProfile)
        : state.kind === "signed_out"
          ? item("Sign In to GitHub…", () => {
              auth.mutate("signIn");
              onOpenProfile();
            })
          : state.kind === "cli_missing"
            ? item("Install GitHub CLI", () => openExternal(INSTALL_GITHUB_CLI_URL))
            : state.kind === "signing_in"
              ? item("Finish GitHub Sign-In…", onOpenProfile)
              : item("GitHub…", onOpenProfile)}
    </MenuGroup>
  );
}

function NyteGroup({
  connect,
  onOpenProfile,
}: {
  readonly connect: ConnectBridge;
  readonly onOpenProfile: () => void;
}): ReactElement | null {
  const view = useConnectView(connect).data;
  const signIn = useConnectAction(() => connect.openAccount(), "Couldn’t sign in");

  if (view === undefined || view.kind === "unavailable" || view.account.kind === "unavailable")
    return null;

  const { account } = view;

  return (
    <MenuGroup>
      <MenuGroupLabel>Nyte account</MenuGroupLabel>
      {account.kind === "signed_in" ? (
        <MenuItem icon="user" variant="quiet" onClick={onOpenProfile}>
          {account.label}
        </MenuItem>
      ) : (
        <MenuItem
          icon="user"
          disabled={signIn.isPending}
          variant="quiet"
          onClick={() => signIn.mutate()}
        >
          Sign In to Nyte…
        </MenuItem>
      )}
    </MenuGroup>
  );
}

export function AccountFooterMenu({
  account,
  connect,
  anchor,
  onOpenProfile,
}: {
  readonly account: GitHubAccountState;
  readonly connect: ConnectBridge;
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly onOpenProfile: () => void;
}): ReactElement {
  const github = useGitHubAuth();
  const update = useUpdateState().data ?? { kind: "idle" };
  const busy = update.kind === "downloading" || update.kind === "installing";
  const attention = update.kind !== "idle" && !busy;
  const signedIn = account.kind === "ready" ? account.account : undefined;

  return (
    <Menu highlightItemOnHover={false}>
      <MenuTrigger
        render={
          <Row
            variant="nav"
            aria-busy={github.busy || undefined}
            xstyle={[styles.navRow, styles.accountButton]}
          >
            <Row.Leading xstyle={styles.avatarSlot}>
              {signedIn?.avatarUrl !== undefined ? (
                <img alt="" src={signedIn.avatarUrl} {...props(styles.avatar)} />
              ) : (
                <Icon name={signedIn === undefined ? "laptop" : "user"} size={14} />
              )}
            </Row.Leading>
            <Row.Label xstyle={styles.accountLabel}>
              <span {...props(styles.accountName)}>
                {signedIn?.login ?? nyte.machineName ?? "Profile"}
              </span>
              {attention && (
                <span
                  {...props(styles.updateDot, update.kind === "failed" && intent.danger)}
                  aria-hidden="true"
                />
              )}
            </Row.Label>
          </Row>
        }
      />
      <MenuContent side="top" align="start" anchor={anchor} sideOffset={4} matchAnchorWidth>
        {nyte.host.updates !== undefined && (
          <>
            <MenuItem
              layout="plain"
              disabled={busy}
              variant={update.kind === "failed" ? "danger" : "quiet"}
              onClick={() => void nyte.host.updates?.check().catch(() => undefined)}
            >
              {updateLabel(update)}
            </MenuItem>
            <MenuSeparator inset />
          </>
        )}
        <GitHubGroup state={account} github={github} onOpenProfile={onOpenProfile} />
        <NyteGroup connect={connect} onOpenProfile={onOpenProfile} />
        <MenuSeparator inset />
        <MenuItem icon="bubble-heart" variant="quiet" onClick={() => openExternal(FEEDBACK_URL)}>
          Give Feedback
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
