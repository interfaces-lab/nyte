import { accountAppearance } from "@nyte-ai/app/account/appearance.ts";
import { ClerkLoading, ClerkProvider, SignIn, useClerk } from "@clerk/electron/react";
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import type { AccountAnswer, AccountCommand, AccountReport } from "./protocol.ts";

type Clerk = ReturnType<typeof useClerk>;

type User = NonNullable<Clerk["user"]>;

const bridge = window.nyteAccount;

const redirectUrl = new URL(window.location.pathname, window.location.href).href;

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
  let disposed = false;

  const answer = (result: AccountAnswer): void => {
    if (!disposed && command?.id === result.id) bridge.answer(result);
  };

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
    if (disposed) return;
    show(command?.kind === "token" && clerk.session?.status !== "active" ? command : undefined);

    if (clerk.status === "error") {
      if (command !== undefined) {
        answer({ id: command.id, kind: "failed", reason: "unreachable" });
        command = undefined;
      }

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
          () => answer({ id, kind: "signed_out" }),
          () => answer({ id, kind: "failed", reason: "sign_out_failed" }),
        )
        .finally(finish(id));

      return;
    }

    // Signed out or a session task still open: the page shows Clerk until it is done.
    if (session === undefined) return;

    if (session.actor != null) {
      answer({ id, kind: "failed", reason: "impersonated" });
      command = undefined;

      return;
    }

    working = true;
    void session
      .getToken({ skipCache: true })
      .then(
        (token) =>
          answer(
            token === null
              ? { id, kind: "failed", reason: "no_token" }
              : { id, kind: "token", token },
          ),
        () => answer({ id, kind: "failed", reason: "no_token" }),
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
    disposed = true;
    stopCommands();
    stopResources();
    clerk.off("status", onStatus);
  };
}

function Account({
  onPrompt,
}: {
  readonly onPrompt: (command: AccountCommand | undefined) => void;
}): null {
  const clerk = useClerk();

  useEffect(() => connect(clerk, onPrompt), [clerk, onPrompt]);

  return null;
}

function Provider({
  publishableKey,
  onPrompt,
  children,
}: {
  readonly publishableKey: string;
  readonly onPrompt: (command: AccountCommand | undefined) => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ClerkProvider publishableKey={publishableKey} telemetry={false} appearance={accountAppearance}>
      <Account onPrompt={onPrompt} />
      {children}
    </ClerkProvider>
  );
}

function Form(): ReactElement {
  return (
    <>
      <ClerkLoading>Loading…</ClerkLoading>
      <SignIn
        routing="hash"
        withSignUp
        forceRedirectUrl={redirectUrl}
        signUpForceRedirectUrl={redirectUrl}
      />
    </>
  );
}

export const accountRuntime = { Provider, Form };

window.nyteAccountRuntime = accountRuntime;
