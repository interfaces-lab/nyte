import clerkEntryUrl from "virtual:nyte-clerk-entry";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import { create, props } from "@stylexjs/stylex";
import { CatchBoundary } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { accountRuntime } from "./clerk.tsx";
import type { AccountBridge, AccountCommand } from "./protocol.ts";

declare global {
  interface Window {
    readonly nyteAccount: AccountBridge;
    nyteAccountRuntime?: typeof accountRuntime;
  }
}

type RuntimeState =
  | { readonly kind: "idle" | "loading" | "failed" }
  | {
      readonly kind: "ready";
      readonly runtime: typeof accountRuntime;
      readonly publishableKey: string;
    };

const bridge = window.nyteAccount;

let runtimeLoad: Promise<typeof accountRuntime> | undefined;

let runtimeAttempt = 0;

function loadRuntime(): Promise<typeof accountRuntime> {
  if (window.nyteAccountRuntime !== undefined) return Promise.resolve(window.nyteAccountRuntime);

  if (runtimeLoad !== undefined) return runtimeLoad;

  const script = document.createElement("script");

  const url = new URL(clerkEntryUrl, window.location.href);

  if (runtimeAttempt > 0) url.searchParams.set("attempt", String(runtimeAttempt));
  runtimeAttempt += 1;
  script.type = "module";
  script.src = url.href;
  runtimeLoad = new Promise<typeof accountRuntime>((resolve, reject) => {
    const fail = () => reject(new Error("Account runtime did not load"));
    const timeout = window.setTimeout(fail, 15_000);

    script.onload = () => {
      window.clearTimeout(timeout);

      if (window.nyteAccountRuntime === undefined) fail();
      else resolve(window.nyteAccountRuntime);
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      fail();
    };

    document.head.append(script);
  }).catch(() => {
    runtimeLoad = undefined;
    script.remove();
    throw new Error("Account runtime did not load");
  });

  return runtimeLoad;
}

const styles = create({
  popup: { padding: 0, width: "auto" },
  pending: { padding: 24, minWidth: 320 },
  close: { position: "absolute", insetBlockStart: 8, insetInlineEnd: 8 },
});

function AccountLoader(): ReactElement {
  const [state, setState] = useState<RuntimeState>({ kind: "idle" });
  const [prompt, setPrompt] = useState<AccountCommand>();
  const [attempt, setAttempt] = useState(0);
  const command = useRef<AccountCommand | undefined>(undefined);
  const ready = state.kind === "ready";

  useEffect(() => {
    if (ready) return;
    let disposed = false;
    let requested = false;

    const stop = bridge.onCommand((next) => {
      command.current = next;
      setPrompt(next?.kind === "token" ? next : undefined);

      if (next === undefined || requested) return;
      requested = true;
      setState({ kind: "loading" });
      void bridge
        .config()
        .then(async (config) => {
          if (disposed) return;

          if (command.current === undefined) {
            requested = false;
            setState({ kind: "idle" });

            return;
          }

          if (config === undefined) throw new Error("Accounts are not configured");
          const runtime = await loadRuntime();

          if (disposed) return;
          requested = false;

          if (command.current === undefined) {
            setState({ kind: "idle" });

            return;
          }

          setState({ kind: "ready", runtime, publishableKey: config.publishableKey });
        })
        .catch(() => {
          if (disposed) return;
          requested = false;
          setState({ kind: "failed" });

          if (command.current?.kind === "sign_out") {
            bridge.answer({ id: command.current.id, kind: "failed", reason: "sign_out_failed" });
          }
        });
    });

    return () => {
      disposed = true;
      stop();
    };
  }, [ready, attempt]);

  const dialog = (
    <AccountDialog
      prompt={prompt}
      onDismiss={() => {
        command.current = undefined;
        setPrompt(undefined);
      }}
    >
      {state.kind === "ready" ? (
        <state.runtime.Form />
      ) : (
        <div {...props(styles.pending)}>
          {state.kind === "failed" ? (
            <>
              <p role="alert">Couldn’t load sign-in.</p>
              <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
            </>
          ) : (
            <span role="status">Loading…</span>
          )}
        </div>
      )}
    </AccountDialog>
  );

  return state.kind === "ready" ? (
    <state.runtime.Provider publishableKey={state.publishableKey} onPrompt={setPrompt}>
      {dialog}
    </state.runtime.Provider>
  ) : (
    dialog
  );
}

function AccountDialog({
  prompt,
  onDismiss,
  children,
}: {
  readonly prompt: AccountCommand | undefined;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Dialog.Root
      open={prompt !== undefined}
      onOpenChange={(open) => {
        if (!open && prompt !== undefined) {
          onDismiss();
          bridge.answer({ id: prompt.id, kind: "cancelled" });
        }
      }}
    >
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Title xstyle={srOnly}>Sign In to Nyte</Dialog.Title>
        {children}
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

function AccountUnavailable({ reset }: { readonly reset: () => void }): ReactElement {
  const [prompt, setPrompt] = useState<AccountCommand>();

  useEffect(
    () =>
      bridge.onCommand((command) => {
        setPrompt(command?.kind === "token" ? command : undefined);

        if (command?.kind === "sign_out") {
          bridge.answer({ id: command.id, kind: "failed", reason: "sign_out_failed" });
        }
      }),
    [],
  );

  return (
    <AccountDialog prompt={prompt} onDismiss={() => setPrompt(undefined)}>
      <div {...props(styles.pending)}>
        <p role="alert">Couldn’t load sign-in.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </AccountDialog>
  );
}

export function AccountProvider({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <>
      {children}
      <CatchBoundary getResetKey={() => "account"} errorComponent={AccountUnavailable}>
        <AccountLoader />
      </CatchBoundary>
    </>
  );
}
