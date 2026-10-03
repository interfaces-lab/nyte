import { ClerkLoading, ClerkProvider, SignIn, useClerk } from "@clerk/electron/react";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import { create } from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { AccountBridge, AccountCommand, AccountReport } from "./protocol.ts";

declare global {
  interface Window {
    readonly nyteAccount: AccountBridge;
  }
}

type Clerk = ReturnType<typeof useClerk>;

type User = NonNullable<Clerk["user"]>;

const bridge = window.nyteAccount;

const redirectUrl = new URL(window.location.pathname, window.location.href).href;

const styles = create({
  popup: { padding: 0, width: "auto" },
  close: { position: "absolute", insetBlockStart: 8, insetInlineEnd: 8 },
});

/** The account's sign-in address and nothing more: no name, username, or photo. */
function labelOf(user: User): string {
  return (
    user.primaryEmailAddress?.emailAddress ?? user.primaryPhoneNumber?.phoneNumber ?? "Nyte account"
  );
}

/** Reports state to main and serves its one pending command. Returns the teardown. */
function connect(clerk: Clerk, show: (command: AccountCommand | undefined) => void): () => void {
  let command: AccountCommand | undefined;
  let working = false;
  let reported = "";

  const report = (next: AccountReport): void => {
    const key = JSON.stringify(next);

    if (key === reported) return;
    reported = key;
    bridge.report(next);
  };

  const finish = (id: string) => (): void => {
    working = false;

    if (command?.id === id) command = undefined;
    sync();
  };

  const sync = (): void => {
    show(command?.kind === "token" && clerk.session?.status !== "active" ? command : undefined);

    if (clerk.status === "error") {
      report({ kind: "unreachable" });

      return;
    }

    if (!clerk.loaded) return;
    const user = clerk.user;
    const session = clerk.session?.status === "active" ? clerk.session : undefined;

    report(
      session !== undefined && user != null
        ? { kind: "signed_in", label: labelOf(user) }
        : { kind: "signed_out" },
    );

    if (working || command === undefined) return;
    const { id } = command;

    if (command.kind === "sign_out") {
      working = true;
      void clerk
        .signOut()
        .then(
          () => bridge.answer({ id, kind: "signed_out" }),
          () => bridge.answer({ id, kind: "failed", reason: "sign_out_failed" }),
        )
        .finally(finish(id));

      return;
    }

    // Signed out or a session task still open: the page shows Clerk until it is done.
    if (session === undefined) return;

    if (session.actor != null) {
      command = undefined;
      bridge.answer({ id, kind: "failed", reason: "impersonated" });

      return;
    }

    working = true;
    void session
      .getToken({ skipCache: true })
      .then(
        (token) =>
          bridge.answer(
            token === null
              ? { id, kind: "failed", reason: "no_token" }
              : { id, kind: "token", token },
          ),
        () => bridge.answer({ id, kind: "failed", reason: "no_token" }),
      )
      .finally(finish(id));
  };

  const onStatus = (): void => sync();

  const stopCommands = bridge.onCommand((next) => {
    command = next;
    sync();
  });

  const stopResources = clerk.addListener(sync);

  clerk.on("status", onStatus, { notify: true });

  return () => {
    stopCommands();
    stopResources();
    clerk.off("status", onStatus);
  };
}

function Account(): ReactElement {
  const clerk = useClerk();
  const [prompt, setPrompt] = useState<AccountCommand>();

  useEffect(() => connect(clerk, setPrompt), [clerk]);

  return (
    <Dialog.Root
      open={prompt !== undefined}
      onOpenChange={(open) => {
        if (!open && prompt !== undefined) bridge.answer({ id: prompt.id, kind: "cancelled" });
      }}
    >
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={srOnly}>Sign In to Nyte</Dialog.Title>
        <ClerkLoading>Loading…</ClerkLoading>
        <SignIn
          routing="hash"
          withSignUp
          forceRedirectUrl={redirectUrl}
          signUpForceRedirectUrl={redirectUrl}
        />
        <Dialog.Close
          render={
            <Button iconOnly aria-label="Close sign-in">
              <Icon name="x" />
            </Button>
          }
          xstyle={styles.close}
        />
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export function AccountProvider({
  publishableKey,
  children,
}: {
  readonly publishableKey: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  if (publishableKey === undefined) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      telemetry={false}
      appearance={{
        variables: {
          colorPrimary: "var(--nyte-content-primary)",
          colorPrimaryForeground: "var(--nyte-bg-elevated)",
          colorNeutral: "var(--nyte-content-primary)",
          colorForeground: "var(--nyte-content-primary)",
          colorBackground: "var(--nyte-bg-elevated)",
          colorMuted: "var(--nyte-bg-muted)",
          colorMutedForeground: "var(--nyte-content-secondary)",
          colorInput: "var(--nyte-bg-base)",
          colorInputForeground: "var(--nyte-content-primary)",
          colorRing: "var(--nyte-content-primary)",
        },
        elements: { cardBox: { boxShadow: "none" } },
      }}
    >
      <Account />
      {children}
    </ClerkProvider>
  );
}
