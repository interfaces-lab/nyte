import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, useAuth, useClerk } from "@clerk/react";
import { createBrokerClient } from "@nyte-ai/connect";
import type { DeviceRole, EnvironmentSummary } from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useId, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import { AccountScope, accountAppearance } from "../account/appearance.tsx";
import { serverConnectionProblem } from "../server-connection.ts";
import type { Connection } from "./bridge.ts";
import {
  accountRoute,
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
import { IdentityChanged } from "./identity.ts";
import { webBridge } from "./install.ts";
import { connectPinned } from "./pins.ts";
import { WebPage } from "./web-page.tsx";

const styles = create({
  list: {
    display: "flex",
    flexDirection: "column",
    padding: 4,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  leading: { color: role.contentSecondary },
  offline: { color: role.contentDisabled },
  wrap: {
    overflow: "visible",
    overflowWrap: "anywhere",
    textOverflow: "clip",
    whiteSpace: "normal",
  },
  status: { margin: 0, color: role.contentSecondary, textAlign: "center" },
  frame: { display: "flex", flexDirection: "column", height: "100%" },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 4,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  barName: {
    flex: 1,
    minWidth: 0,
    color: role.contentPrimary,
    overflowWrap: "anywhere",
  },
  shell: { flex: 1, minHeight: 0, position: "relative" },
});

export function DesktopList({
  environments,
  connecting,
  disabled,
  onPick,
}: {
  readonly environments: readonly EnvironmentSummary[];
  readonly connecting: string | undefined;
  readonly disabled: boolean;
  /** Connect as a controller, or ask for folder administration, which the host grants only when started with `--device-admin`. */
  readonly onPick: (environment: EnvironmentSummary, role: DeviceRole) => void;
}): ReactElement {
  const labelId = useId();

  return (
    <div {...props(styles.list)}>
      {environments.map((environment) => (
        <Row
          key={environment.id}
          size="lg"
          interactive={environment.online}
          xstyle={!environment.online && styles.offline}
        >
          <Row.Primary
            disabled={!environment.online || disabled}
            onClick={() => onPick(environment, "controller")}
          >
            <Row.Leading xstyle={environment.online && styles.leading}>
              <Icon name="laptop" size={16} />
            </Row.Leading>
            <Row.Body>
              <Row.Label id={`${labelId}-${environment.id}`} xstyle={styles.wrap}>
                {environment.name}
              </Row.Label>
              <Row.Description>{environment.online ? "Online" : "Offline"}</Row.Description>
            </Row.Body>
          </Row.Primary>
          <Row.Meta>
            {connecting === environment.id ? (
              <Spinner />
            ) : (
              environment.online && (
                <Button
                  size="xs"
                  disabled={disabled}
                  aria-describedby={`${labelId}-${environment.id}`}
                  onClick={() => onPick(environment, "owner")}
                >
                  Connect as Admin
                </Button>
              )
            )}
          </Row.Meta>
        </Row>
      ))}
    </div>
  );
}

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
  /** The environment answered with another host identity than the one pinned; only a re-pair proceeds. */
  const [changed, setChanged] = useState<{ environment: EnvironmentSummary; role: DeviceRole }>();
  /** Clerk kept the session. This document already left its host, so it offers nothing but another try. */
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [connecting, setConnecting] = useState<string>();
  const [shell, setShell] = useState<ReactNode>();
  const [name, setName] = useState("Manual connection");
  const active = useRef<AccountDevice | undefined>(undefined);
  /** This document adopted a host. Its caches and sends belong to that host, so leaving this flow reloads. */
  const adopted = useRef(false);
  const work = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);

  const adopt = (connection: Connection, signal?: AbortSignal): void => {
    adopted.current = true;
    onConnected(connection, (node) => {
      if (signal?.aborted !== true) setShell(node);
    });
  };

  const refresh = async (
    signal: AbortSignal,
  ): Promise<readonly EnvironmentSummary[] | undefined> => {
    setProblem(undefined);
    setProgress("Loading desktops…");
    let listed: readonly EnvironmentSummary[] | undefined;

    try {
      listed = (await broker.listEnvironments({ signal })).environments;

      if (!signal.aborted) setEnvironments(listed);
    } catch (cause) {
      if (!signal.aborted) setProblem(accountProblem(cause));
    }

    if (!signal.aborted) setProgress(undefined);

    return listed;
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
          await connectPinned({
            bridge: webBridge,
            storage: localStorage,
            route: accountRoute(saved),
            connection,
            repair: false,
            options: {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
              relay: true,
              principal: saved.deviceId,
            },
          });

          if (!controller.signal.aborted) adopt(connection, controller.signal);
        } catch (cause) {
          if (controller.signal.aborted) return;

          if (cause instanceof IdentityChanged) {
            forgetAccountDevice(sessionStorage);
            active.current = undefined;
            void releaseAccountDevice(saved);
            const listed = await refresh(controller.signal);

            if (controller.signal.aborted) return;

            const environment = listed?.find(
              (candidate) => candidate.id === saved.environmentId,
            ) ?? { id: saved.environmentId, name: saved.name, online: true, lastSeenAt: null };

            setChanged({ environment, role: saved.role });

            return;
          }

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
      }

      if (device !== undefined || adopted.current) location.replace("/");
    };
  });

  /** `repair`: the owner decided this environment is a new host, so whichever host proves itself replaces the pin. */
  const pick = async ({
    environment,
    role,
    repair,
  }: {
    readonly environment: EnvironmentSummary;
    readonly role: DeviceRole;
    readonly repair: boolean;
  }): Promise<void> => {
    if (busy.current || ownerId === undefined) return;
    busy.current = true;
    const controller = new AbortController();
    work.current?.abort();
    work.current = controller;
    setProblem(undefined);
    setChanged(undefined);
    setConnecting(environment.id);
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
        role,
        repair,
        signal: controller.signal,
      });

      if (device !== undefined && !controller.signal.aborted) {
        active.current = device;
        setName(device.name);
        forgetConnection();
        adopt(accountConnection(device), controller.signal);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;

      if (cause instanceof IdentityChanged) setChanged({ environment, role });
      else setProblem(accountProblem(cause));
    }

    busy.current = false;

    if (!controller.signal.aborted) {
      setConnecting(undefined);
      setProgress(undefined);
    }
  };

  const leave = async (signOut: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    work.current?.abort();
    setProgress(signOut ? "Signing out…" : "Disconnecting…");
    const device = active.current;
    active.current = undefined;
    forgetAccountDevice(sessionStorage);

    if (device !== undefined) {
      if (signOut) await revokeAccountDevice(device, broker);
      else await releaseAccountDevice(device);
    }

    if (signOut) {
      try {
        await clerk.signOut();
      } catch {
        busy.current = false;
        setShell(undefined);
        setProgress(undefined);
        setSignOutFailed(true);

        return;
      }

      forgetClientId(sessionStorage);
    }

    forgetConnection();
    location.replace("/");
  };

  const openManual = (): void => {
    const previous = active.current;
    active.current = undefined;
    forgetAccountDevice(sessionStorage);

    if (previous !== undefined) void releaseAccountDevice(previous);
    setManual(true);
  };

  const manualButton = (
    <Button size="sm" disabled={progress !== undefined} onClick={openManual}>
      Use Address and Token
    </Button>
  );

  if (signOutFailed) {
    return (
      <WebPage title="Couldn't Sign Out" busy={progress !== undefined} status={progress}>
        <p role="alert" {...props(styles.status)}>
          Check your connection and try again.
        </p>
        <Button variant="solid" disabled={progress !== undefined} onClick={() => void leave(true)}>
          Try Again
        </Button>
      </WebPage>
    );
  }

  if (shell !== undefined) {
    return (
      <div {...props(styles.frame)}>
        <div {...props(styles.bar)}>
          <Icon name="laptop" size={14} />
          <span {...props(styles.barName)}>{name}</span>
          <Button size="xs" disabled={progress !== undefined} onClick={() => void leave(false)}>
            Switch Desktop
          </Button>
          <Button size="xs" disabled={progress !== undefined} onClick={() => void leave(true)}>
            Sign Out
          </Button>
        </div>
        <div {...props(styles.shell)}>{shell}</div>
      </div>
    );
  }

  if (manual) {
    return (
      <ConnectScreen
        onBack={() => setManual(false)}
        onConnected={(connection) => adopt(connection)}
      />
    );
  }

  if (ownerId === undefined) {
    return (
      <WebPage footer={manualButton}>
        <AccountScope>
          <SignIn
            routing="hash"
            withSignUp
            forceRedirectUrl={redirectUrl}
            signUpForceRedirectUrl={redirectUrl}
          />
        </AccountScope>
      </WebPage>
    );
  }

  const email = clerk.user?.primaryEmailAddress?.emailAddress;

  return (
    <WebPage
      title="Choose a Desktop"
      description={
        environments?.length === 0
          ? "Turn on remote access in Nyte on your desktop to see it here."
          : email
      }
      busy={progress !== undefined}
      status={progress}
      footer={
        <>
          <Button
            size="sm"
            icon="refresh"
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
          {manualButton}
          <Button size="sm" disabled={progress !== undefined} onClick={() => void leave(true)}>
            Sign Out
          </Button>
        </>
      }
    >
      {environments !== undefined && environments.length > 0 && (
        <DesktopList
          environments={environments}
          connecting={connecting}
          disabled={progress !== undefined}
          onPick={(environment, role) => void pick({ environment, role, repair: false })}
        />
      )}
      {changed !== undefined && (
        <div role="alert" {...props(styles.status)}>
          <p>
            {changed.environment.name} answers with a different host identity than the one you
            paired with. Pair again only if you replaced or reinstalled that host.
          </p>
          <Button
            size="sm"
            disabled={progress !== undefined}
            onClick={() => void pick({ ...changed, repair: true })}
          >
            Pair as New Host
          </Button>
        </div>
      )}
      {problem !== undefined && (
        <p role="alert" {...props(styles.status)}>
          {problem}
        </p>
      )}
      {problem === undefined && progress !== undefined && (
        <p aria-hidden {...props(styles.status)}>
          {progress}
        </p>
      )}
    </WebPage>
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
      <WebPage
        footer={
          <Button size="sm" onClick={() => setManual(true)}>
            Use Address and Token
          </Button>
        }
      >
        <p role="status" {...props(styles.status)}>
          <ClerkLoading>
            <Spinner />
            <span {...props(srOnly)}>Loading sign-in</span>
          </ClerkLoading>
        </p>
        <ClerkFailed>
          <p role="alert" {...props(styles.status)}>
            Couldn't load sign-in.
          </p>
          <Button variant="outline" onClick={() => location.reload()}>
            Reload
          </Button>
        </ClerkFailed>
      </WebPage>
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
