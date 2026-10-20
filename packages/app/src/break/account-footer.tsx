import "./install.ts";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../theme/boot.ts";
import "../theme/focus-modality.ts";
import "../theme/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toggle } from "@nyte-ai/ui/toggle";
import { props } from "@stylexjs/stylex";
import { StrictMode, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { GitHubAccountState } from "@nyte-ai/sdk";
import type { ConnectView, UpdateState } from "../bridge.ts";
import { AccountFooterMenu } from "../chrome/account-footer.tsx";
import { sidebarStyles as styles } from "../chrome/sidebar.stylex.ts";
import { keys } from "../query-keys.ts";

const OCTOCAT = "https://avatars.githubusercontent.com/u/583231?v=4";

const pending = (): Promise<never> => new Promise<never>(() => undefined);

const connect = {
  state: pending,
  link: pending,
  cancel: pending,
  setEnabled: pending,
  unlink: pending,
  revokeDevice: pending,
  openAccount: pending,
  signOut: pending,
};

const NYTE_SIGNED_IN = {
  kind: "unlinked",
  account: { kind: "signed_in", label: "owner@example.test" },
  linking: { kind: "idle" },
  notice: { kind: "none" },
} satisfies ConnectView;

const IDLE = { kind: "idle" } satisfies UpdateState;

interface Scenario {
  readonly label: string;
  readonly account: GitHubAccountState;
  readonly update?: UpdateState;
}

const SCENARIOS: readonly Scenario[] = [
  {
    label: "Signed in, short login, avatar",
    account: { kind: "ready", account: { login: "octocat", avatarUrl: OCTOCAT } },
  },
  {
    label: "Signed in, no avatar",
    account: { kind: "ready", account: { login: "octocat" } },
  },
  {
    label: "Signed in, 39-character login (GitHub's maximum)",
    account: {
      kind: "ready",
      account: { login: "a-very-long-github-login-name-at-the-max", avatarUrl: OCTOCAT },
    },
  },
  {
    label: "Signed in, avatar URL that 404s",
    account: {
      kind: "ready",
      account: { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/0?v=4" },
    },
  },
  {
    label: "Signed in, update ready (dot)",
    account: { kind: "ready", account: { login: "octocat", avatarUrl: OCTOCAT } },
    update: { kind: "ready", version: "1.4.0" },
  },
  {
    label: "Signed in, 39-character login, update failed (danger dot)",
    account: {
      kind: "ready",
      account: { login: "a-very-long-github-login-name-at-the-max", avatarUrl: OCTOCAT },
    },
    update: { kind: "failed", version: "1.4.0", message: "Download failed" },
  },
  {
    label: "Signed out: falls back to the machine name",
    account: { kind: "signed_out" },
  },
  {
    label: "GitHub CLI missing",
    account: { kind: "cli_missing" },
  },
  {
    label: "Signing in, waiting for the device code",
    account: {
      kind: "signing_in",
      deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
    },
  },
  {
    label: "Error reading the account",
    account: { kind: "error", message: "Couldn't reach GitHub. Try again." },
  },
  {
    label: "Signed out, update downloading (no dot)",
    account: { kind: "signed_out" },
    update: { kind: "downloading", version: "1.4.0", percent: 40 },
  },
];

const WIDTHS = [
  { label: "Sidebar minimum, 214 px", width: 214 },
  { label: "Typical, 280 px", width: 280 },
  { label: "Sidebar maximum, 400 px", width: 400 },
];

function Footer({ scenario }: { readonly scenario: Scenario }): ReactElement {
  const anchor = useRef<HTMLDivElement>(null);
  const [client] = useState(() => {
    const created = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
    created.setQueryData(keys.updates, scenario.update ?? IDLE);
    created.setQueryData(keys.connect, NYTE_SIGNED_IN);

    return created;
  });

  return (
    <QueryClientProvider client={client}>
      <div {...props(styles.footer)}>
        <div ref={anchor} {...props(styles.footerRow)}>
          <AccountFooterMenu
            account={scenario.account}
            connect={connect}
            anchor={anchor}
            onOpenProfile={() => undefined}
          />
          <Toggle iconOnly icon="settings" aria-label="Settings" />
        </div>
      </div>
    </QueryClientProvider>
  );
}

function Harness(): ReactElement {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 32, padding: 24 }}>
      <h1 style={{ margin: 0 }}>Break: AccountFooterMenu</h1>
      <p style={{ margin: 0 }}>
        Machine name fixture: “Workgyver’s MacBook Pro (16-inch)”. Click a footer to open its menu.
      </p>
      {SCENARIOS.map((scenario) => (
        <section key={scenario.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>{scenario.label}</h2>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {WIDTHS.map((width) => (
              <div key={width.width} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <small>{width.label}</small>
                <div style={{ width: width.width, outline: "1px dashed currentColor" }}>
                  <div {...props(styles.rail)}>
                    <Footer scenario={scenario} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

const container = document.getElementById("root");

if (container !== null)
  createRoot(container).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
