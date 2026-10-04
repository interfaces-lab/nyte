import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, useAuth, useClerk } from "@clerk/react";
import { createBrokerClient } from "@nyte-ai/connect";
import type { EnvironmentSummary } from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import { Button } from "@nyte-ai/ui/button";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import { accountAppearance } from "../account/appearance.ts";
import { serverConnectionProblem } from "../server-connection.ts";
import type { Connection } from "./bridge.ts";
import {
  connectAccountEnvironment,
  releaseAccountDevice,
  revokeAccountDevice,
} from "./account-connection.ts";
import { accountProblem } from "./account-copy.ts";
import {
  accountConnection,
  forgetAccountDevice,
  forgetClientId,
  loadAccountDevice,
} from "./account-device.ts";
import type { AccountDevice } from "./account-device.ts";
import { ConnectScreen } from "./connect-screen.tsx";
import { forgetConnection } from "./connection.ts";
import { webBridge } from "./install.ts";

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    height: "100%",
    padding: 24,
    overflowY: "auto",
    backgroundColor: role.bgBase,
  },
  heading: { margin: 0, fontSize: type.fontLg, lineHeight: type.leadingLg, fontWeight: "inherit" },
  text: { margin: 0, color: role.contentSecondary },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  actions: { display: "flex", alignItems: "center", gap: 12 },
  frame: { display: "flex", flexDirection: "column", height: "100%" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingInline: 12,
    paddingBlock: 6,
    backgroundColor: role.bgBase,
  },
  shell: { flex: 1, minHeight: 0, position: "relative" },
});

export interface AccountScreenProps {
  readonly config: AccountConfig;
  readonly onConnected: (connection: Connection, mount: (shell: ReactNode) => void) => void;
}

function AccountFlow({
  config,
  onConnected,
  ownerId,
}: AccountScreenProps & { readonly ownerId: string | undefined }): ReactElement {
  const redirectUrl = new URL(location.pathname, location.href).href;
  const clerk = useClerk();
  const { getToken } = useAuth();

  const broker = useMemo(
    () =>
      createBrokerClient({
        origin: config.origin,
        sessionToken: () =>
          clerk.user?.id === ownerId && clerk.session?.status === "active"
            ? getToken({ skipCache: true })
            : Promise.resolve(null),
      }),
    [clerk, config.origin, getToken, ownerId],
  );

  const [manual, setManual] = useState(false);
  const [environments, setEnvironments] = useState<readonly EnvironmentSummary[]>();
  const [problem, setProblem] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [shell, setShell] = useState<ReactNode>();
  const [name, setName] = useState("Manual connection");
  const active = useRef<AccountDevice | undefined>(undefined);
  const work = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);

  const refresh = async (signal: AbortSignal): Promise<void> => {
    setProblem(undefined);
    setProgress("Loading desktops…");

    try {
      const list = await broker.listEnvironments({ signal });

      if (!signal.aborted) setEnvironments(list.environments);
    } catch (cause) {
      if (!signal.aborted) setProblem(accountProblem(cause));
    }

    if (!signal.aborted) setProgress(undefined);
  };

  useMountEffect(() => {
    const controller = new AbortController();
    work.current = controller;

    const resume = async (): Promise<void> => {
      if (ownerId === undefined) {
        forgetAccountDevice(sessionStorage);

        return;
      }

      const saved = loadAccountDevice(sessionStorage, config, ownerId);

      if (saved !== undefined) {
        active.current = saved;
        setName(saved.name);
        setProgress(`Connecting to ${saved.name}…`);

        try {
          const connection = accountConnection(saved);
          await webBridge.connect(
            connection,
            AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          );

          if (!controller.signal.aborted)
            onConnected(connection, (node) => {
              if (!controller.signal.aborted) setShell(node);
            });
        } catch (cause) {
          if (controller.signal.aborted) return;

          if (serverConnectionProblem(cause).kind === "authentication") {
            forgetAccountDevice(sessionStorage);
            active.current = undefined;
            void releaseAccountDevice(saved);
          }

          await refresh(controller.signal);

          if (!controller.signal.aborted) setProblem(accountProblem(cause));
        }

        if (!controller.signal.aborted) setProgress(undefined);

        return;
      }

      forgetAccountDevice(sessionStorage);
      await refresh(controller.signal);
    };

    void resume();

    return () => {
      controller.abort();
      work.current?.abort();
      const device = active.current;

      if (device !== undefined) {
        forgetAccountDevice(sessionStorage);
        void releaseAccountDevice(device);
        location.replace("/");
      }
    };
  });

  const pick = async (environment: EnvironmentSummary): Promise<void> => {
    if (busy.current || ownerId === undefined) return;
    busy.current = true;
    const controller = new AbortController();
    work.current?.abort();
    work.current = controller;
    setProblem(undefined);
    setProgress(`Connecting to ${environment.name}…`);

    try {
      const previous = active.current;
      active.current = undefined;
      forgetAccountDevice(sessionStorage);

      if (previous !== undefined) await releaseAccountDevice(previous);

      const device = await connectAccountEnvironment({
        broker,
        config,
        ownerId,
        environment,
        signal: controller.signal,
      });

      if (device !== undefined && !controller.signal.aborted) {
        active.current = device;
        setName(device.name);
        forgetConnection();
        onConnected(accountConnection(device), (node) => {
          if (!controller.signal.aborted) setShell(node);
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setProblem(accountProblem(cause));
    }

    busy.current = false;

    if (!controller.signal.aborted) setProgress(undefined);
  };

  const leave = async (signOut: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    work.current?.abort();
    setProgress(signOut ? "Signing out…" : "Disconnecting…");
    const device = active.current;
    active.current = undefined;
    forgetAccountDevice(sessionStorage);
    forgetConnection();

    if (signOut) forgetClientId(sessionStorage);

    try {
      if (device !== undefined) {
        if (signOut) await revokeAccountDevice(device, broker);
        else await releaseAccountDevice(device);
      }

      if (signOut) await clerk.signOut();
      location.replace("/");
    } catch {
      busy.current = false;
      setShell(undefined);
      setProgress(undefined);
      setProblem("Couldn't sign out. Try again.");
    }
  };

  if (shell !== undefined) {
    return (
      <div {...props(styles.frame)}>
        <div {...props(styles.toolbar)}>
          <span>{name}</span>
          <div {...props(styles.actions)}>
            <Button disabled={progress !== undefined} onClick={() => void leave(false)}>
              Switch Desktop
            </Button>
            <Button disabled={progress !== undefined} onClick={() => void leave(true)}>
              Sign Out
            </Button>
          </div>
        </div>
        <div {...props(styles.shell)}>{shell}</div>
      </div>
    );
  }

  if (manual) {
    return (
      <ConnectScreen
        onBack={() => setManual(false)}
        onConnected={(connection) => onConnected(connection, setShell)}
      />
    );
  }

  return (
    <main {...props(styles.page)} aria-busy={progress !== undefined}>
      {ownerId === undefined ? (
        <>
          <SignIn
            routing="hash"
            withSignUp
            forceRedirectUrl={redirectUrl}
            signUpForceRedirectUrl={redirectUrl}
          />
        </>
      ) : (
        <>
          <h1 {...props(styles.heading)}>Your desktops</h1>
          {environments?.length === 0 && (
            <p {...props(styles.text)}>
              Turn on remote access in Nyte on your desktop to see it here.
            </p>
          )}
          <div {...props(styles.list)}>
            {environments?.map((environment) => (
              <Button
                key={environment.id}
                variant="outline"
                disabled={!environment.online || progress !== undefined}
                onClick={() => void pick(environment)}
              >
                {environment.name} · {environment.online ? "Online" : "Offline"}
              </Button>
            ))}
          </div>
          {progress !== undefined && (
            <p role="status" {...props(styles.text)}>
              {progress}
            </p>
          )}
          {problem !== undefined && (
            <p role="alert" {...props(styles.text)}>
              {problem}
            </p>
          )}
          <div {...props(styles.actions)}>
            <Button
              disabled={progress !== undefined}
              onClick={() => {
                work.current?.abort();
                const controller = new AbortController();
                work.current = controller;
                void refresh(controller.signal);
              }}
            >
              Refresh
            </Button>
            <Button disabled={progress !== undefined} onClick={() => void leave(true)}>
              Sign Out
            </Button>
          </div>
        </>
      )}
      <Button
        disabled={progress !== undefined}
        onClick={() => {
          const previous = active.current;
          active.current = undefined;
          forgetAccountDevice(sessionStorage);

          if (previous !== undefined) void releaseAccountDevice(previous);
          setManual(true);
        }}
      >
        Use Address and Token
      </Button>
    </main>
  );
}

function AccountBoundary({ config, onConnected }: AccountScreenProps): ReactElement {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [manual, setManual] = useState(false);
  const [shell, setShell] = useState<ReactNode>();

  if (shell !== undefined) return <>{shell}</>;

  if (manual)
    return (
      <ConnectScreen
        onBack={() => setManual(false)}
        onConnected={(connection) => onConnected(connection, setShell)}
      />
    );

  if (!isLoaded) {
    return (
      <main {...props(styles.page)}>
        <ClerkLoading>
          <p {...props(styles.text)}>Loading sign-in…</p>
        </ClerkLoading>
        <ClerkFailed>
          <p role="alert" {...props(styles.text)}>
            Couldn't load sign-in. Reload to try again.
          </p>
        </ClerkFailed>
        <ClerkFailed>
          <Button onClick={() => location.reload()}>Reload</Button>
        </ClerkFailed>
        <Button onClick={() => setManual(true)}>Use Address and Token</Button>
      </main>
    );
  }

  const ownerId = isSignedIn && userId != null ? userId : undefined;

  return (
    <AccountFlow
      key={ownerId ?? "signed_out"}
      config={config}
      onConnected={onConnected}
      ownerId={ownerId}
    />
  );
}

export function AccountScreen({ config, onConnected }: AccountScreenProps): ReactElement {
  return (
    <ClerkProvider
      publishableKey={config.publishableKey}
      telemetry={false}
      appearance={accountAppearance}
    >
      <AccountBoundary config={config} onConnected={onConnected} />
    </ClerkProvider>
  );
}
