import type { Connection as SdkConnection, HostId } from "@nyte-ai/sdk";
import type {
  HostEvent,
  NyteBridge,
  OpenWorkspaceOutcome,
  RegisterWorkspaceOutcome,
  SelectedWorkspace,
} from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { workspaceName } from "../data/workspaces.ts";
import { connectHost } from "../data/connection.ts";
import type { HostEndpoint } from "../contract/connection.ts";
import { requestFolderPath } from "./add-folder.tsx";
import { directRoute, holdRoute, noteDirect } from "./routes.ts";

export interface Connection {
  readonly url: string;
  readonly token: string;
}

export interface ConnectOptions {
  readonly signal?: AbortSignal;
  readonly relay?: true;
  readonly expect?: HostId;
}

export interface WebBridge {
  readonly bridge: NyteBridge;
  connect(connection: Connection, options?: ConnectOptions): Promise<HostId>;
}

const DIRECT_MS = 4_000;

const NOT_CONNECTED = "The app is not connected to a server.";

const SERVER = "Change servers from the connect screen.";

const REMOTE_ACCESS = "Remote access is turned on from the desktop app.";

const refuse = (message: string) => (): Promise<never> => Promise.reject(new Error(message));

function browserPlatform(): NodeJS.Platform {
  const name = `${navigator.platform} ${navigator.userAgent}`;

  if (/Mac|iPhone|iPad/i.test(name)) return "darwin";

  if (/Win/i.test(name)) return "win32";

  return "linux";
}

async function openEndpoint(
  next: HostEndpoint,
  signal: AbortSignal | undefined,
): Promise<SdkConnection> {
  const establishing = new AbortController();
  const stop = (): void => establishing.abort(signal?.reason);

  if (signal?.aborted === true) stop();
  signal?.addEventListener("abort", stop, { once: true });

  try {
    return await connectHost(next, {
      fetch: (resource, init) =>
        fetch(resource, {
          ...init,
          credentials: "omit",
          signal:
            init?.signal == null
              ? establishing.signal
              : AbortSignal.any([establishing.signal, init.signal]),
        }),
    });
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

async function openDirect(
  options: ConnectOptions | undefined,
): Promise<{ readonly endpoint: HostEndpoint; readonly opened: SdkConnection } | undefined> {
  const hostId = options?.expect;

  if (hostId === undefined) return undefined;
  const url = await directRoute(hostId);

  if (url === undefined) return undefined;

  const endpoint: HostEndpoint = {
    url,
    credentials: { kind: "custom", headers: () => ({}) },
    expect: { hostId },
  };

  const deadline = AbortSignal.timeout(DIRECT_MS);

  const signal =
    options?.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);

  return openEndpoint(endpoint, signal).then(
    (opened) => ({ endpoint, opened }),
    () => {
      if (options?.signal?.aborted !== true) holdRoute(hostId);

      return undefined;
    },
  );
}

function webPageUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function createWebBridge(): WebBridge {
  let endpoint: HostEndpoint | undefined;
  let connection: SdkConnection | undefined;
  let relay: true | undefined;
  let selected: SelectedWorkspace | undefined;
  const listeners = new Set<(event: HostEvent) => void>();

  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const connected = (): SdkConnection => {
    if (connection === undefined) throw new Error(NOT_CONNECTED);

    return connection;
  };

  const registerWorkspace = async ({
    path,
  }: {
    path: string;
  }): Promise<RegisterWorkspaceOutcome> => {
    try {
      const host = connected();
      const seen = await host.workspaces.inspect({ kind: "local", path });
      const added = await host.workspaces.add(seen.target, { expect: { identity: seen.identity } });

      if (added.kind === "stale")
        return { kind: "failed", message: "The folder changed. Try again." };

      if (added.kind === "unavailable")
        return { kind: "failed", message: "This folder is not available on the server." };
      const { trusted } = await host.workspace(added.workspace).info();

      return {
        kind: "registered",
        workspace: { id: added.workspace, path, name: workspaceName(seen) },
        needsTrust: trusted === null && seen.projectSources.length > 0,
      };
    } catch (cause) {
      return { kind: "failed", message: errorMessage(cause) };
    }
  };

  const openWorkspace = async (input: { path: string }): Promise<OpenWorkspaceOutcome> => {
    const registered = await registerWorkspace(input);

    if (registered.kind === "failed") return registered;
    selected = registered.workspace;
    emit({ kind: "workspace_opened", workspace: selected });

    return { kind: "opened", workspace: selected, needsTrust: registered.needsTrust };
  };

  const bridge: NyteBridge = {
    clientSurface: "web",
    platform: browserPlatform(),
    machineName: undefined,
    get relay() {
      return relay;
    },
    host: {
      onMenuCommand: () => () => undefined,
      setThemePreference: () => undefined,
      state: async () => ({ workspace: selected }),
      endpoint: async () => {
        if (endpoint === undefined) throw new Error(NOT_CONNECTED);

        return endpoint;
      },
      fonts: () => Promise.resolve({ sans: [], monospace: [] }),
      openWorkspace,
      registerWorkspace,
      pickWorkspace: async (): Promise<OpenWorkspaceOutcome> => {
        const path = await requestFolderPath(connected().hostId);

        return path === undefined ? { kind: "cancelled" } : openWorkspace({ path });
      },
      pickFolder: () => requestFolderPath(connected().hostId),
      closeWorkspace: async () => {
        selected = undefined;
        emit({ kind: "workspace_closed" });
      },
      server: {
        state: () => Promise.resolve({ kind: "none" }),
        connect: refuse(SERVER),
        disconnect: refuse(SERVER),
      },
      remote: {
        state: () =>
          Promise.resolve({
            kind: "off",
            tailnet: { state: "unavailable" },
            cloudflare: { kind: "unregistered" },
          }),
        start: refuse(REMOTE_ACCESS),
        stop: refuse(REMOTE_ACCESS),
        configure: refuse(REMOTE_ACCESS),
        clear: refuse(REMOTE_ACCESS),
        pair: refuse(REMOTE_ACCESS),
        revoke: refuse(REMOTE_ACCESS),
        configureTailnet: refuse(REMOTE_ACCESS),
        signOutTailnet: refuse(REMOTE_ACCESS),
      },
      connect: {
        state: () => Promise.resolve({ kind: "unavailable", reason: "not_configured" }),
        link: refuse(REMOTE_ACCESS),
        cancel: refuse(REMOTE_ACCESS),
        setEnabled: refuse(REMOTE_ACCESS),
        unlink: refuse(REMOTE_ACCESS),
        revokeDevice: refuse(REMOTE_ACCESS),
        openAccount: refuse(REMOTE_ACCESS),
        signOut: refuse(REMOTE_ACCESS),
      },
      openExternal: async ({ url }) => {
        const page = webPageUrl(url);

        if (page === undefined) throw new Error("Only web pages open from the web app.");
        window.open(page, "_blank", "noopener");
      },
      confirmExternal: async ({ url }) =>
        window.confirm(`Open external website?\n\n${url}`) ? "open" : "cancel",
      pathForFile: () => "",
      onEvent: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    },
  };

  return {
    bridge,
    connect: async ({ url, token }, options) => {
      const chosen: HostEndpoint = {
        url,
        credentials: { kind: "token", token },
        ...(options?.expect === undefined ? {} : { expect: { hostId: options.expect } }),
      };

      const direct = await openDirect(options);
      const next = direct?.endpoint ?? chosen;
      const opened = direct?.opened ?? (await openEndpoint(chosen, options?.signal));

      await connection?.close();
      connection = opened;
      endpoint = next;
      relay = direct === undefined ? options?.relay : undefined;
      selected = undefined;
      noteDirect(direct !== undefined);

      return opened.hostId;
    },
  };
}
