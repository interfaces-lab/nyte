import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, useAuth, useClerk } from "@clerk/react";
import type { ClerkProviderProps } from "@clerk/react";
import { createBrokerClient } from "@nyte-ai/connect";
import type { EnvironmentSummary } from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
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
import { WebPage } from "./web-page.tsx";

const styles = create({
  title: { "--_title": role.contentPrimary },
  accent: {
    "--_accent-fill": role.buttonFill,
    "--_accent-content": role.contentOnInteractiveStrong,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    padding: 4,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  leading: { color: role.contentSecondary },
  offline: { color: role.contentDisabled },
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
    overflow: "hidden",
    color: role.contentPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  shell: { flex: 1, minHeight: 0, position: "relative" },
});

const appearance = {
  ...accountAppearance,
  theme: "simple",
  variables: {
    ...accountAppearance.variables,
    colorPrimary: "var(--_accent-fill)",
    colorPrimaryForeground: "var(--_accent-content)",
    borderRadius: "var(--nyte-shape-control)",
  },
  options: { elevation: "flush", socialButtonsVariant: "blockButton" },
  elements: {
    ...accountAppearance.elements,
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none" },
    headerTitle: {
      fontSize: "var(--nyte-font-size-lg)",
      lineHeight: "var(--nyte-line-height-lg)",
      fontWeight: 600,
      color: "var(--_title)",
    },
    buttonArrowIcon: { display: "none" },
    formFieldInput: { height: "var(--nyte-input-height-md)", paddingBlock: 0 },
    formButtonPrimary: { height: "var(--nyte-btn-height-md)", paddingBlock: 0 },
    socialButtonsBlockButton: { height: "var(--nyte-btn-height-md)", paddingBlock: 0 },
  },
} satisfies NonNullable<ClerkProviderProps["appearance"]>;

export function DesktopList({
  environments,
  connecting,
  disabled,
  onPick,
}: {
  readonly environments: readonly EnvironmentSummary[];
  readonly connecting: string | undefined;
  readonly disabled: boolean;
  readonly onPick: (environment: EnvironmentSummary) => void;
}): ReactElement {
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
            onClick={() => onPick(environment)}
          >
            <Row.Leading xstyle={environment.online && styles.leading}>
              <Icon name="laptop" size={16} />
            </Row.Leading>
            <Row.Body>
              <Row.Label>{environment.name}</Row.Label>
              <Row.Description>{environment.online ? "Online" : "Offline"}</Row.Description>
            </Row.Body>
          </Row.Primary>
          <Row.Meta>
            {connecting === environment.id ? (
              <Spinner />
            ) : (
              environment.online && <Icon name="chevron-right" size={12} />
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
  const [progress, setProgress] = useState<string>();
  const [connecting, setConnecting] = useState<string>();
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
          await webBridge.connect(connection, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            relay: true,
          });

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
        onConnected={(connection) => onConnected(connection, setShell)}
      />
    );
  }

  if (ownerId === undefined) {
    return (
      <WebPage footer={manualButton}>
        <div {...props(styles.title)}>
          <div {...props(intent.primary, styles.accent)}>
            <div {...props(surfaceTheme.gray)}>
              <SignIn
                routing="hash"
                withSignUp
                forceRedirectUrl={redirectUrl}
                signUpForceRedirectUrl={redirectUrl}
              />
            </div>
          </div>
        </div>
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
          onPick={(environment) => void pick(environment)}
        />
      )}
      {(problem ?? progress) !== undefined && (
        <p role={problem !== undefined ? "alert" : "status"} {...props(styles.status)}>
          {problem ?? progress}
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
        <ClerkLoading>
          <p role="status" {...props(styles.status)}>
            <Spinner />
          </p>
        </ClerkLoading>
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
    <ClerkProvider publishableKey={config.publishableKey} telemetry={false} appearance={appearance}>
      <AccountBoundary config={config} onConnected={onConnected} />
    </ClerkProvider>
  );
}
