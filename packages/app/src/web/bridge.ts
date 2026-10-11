/**
 * The bridge a browser installs: where the paired host listens, and a host
 * namespace for what a browser can do itself. Native capabilities such as
 * terminals, browser surfaces, usage history and GitHub are absent. The
 * selected folder is this browser's own, a workspace registered on the host.
 */
import type { Connection as SdkConnection, HostId } from "@nyte-ai/sdk";
import type { HostEvent, NyteBridge, OpenWorkspaceOutcome, SelectedWorkspace } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { workspaceName } from "../view-helpers.ts";
import { connectHost } from "../sdk.tsx";
import type { HostEndpoint } from "../sdk.tsx";
import { requestFolderPath } from "./add-folder.tsx";

/** An address and the token the host issued for it. */
export interface Connection {
  readonly url: string;
  readonly token: string;
}

export interface ConnectOptions {
  /** Ends the connect: a cancelled dialog, a timeout. Requests after it are not tied to it. */
  readonly signal?: AbortSignal;
  readonly relay?: true;
  /** The host this browser pinned at this address; another host answering is refused `stale`. */
  readonly expect?: HostId;
}

export interface WebBridge {
  readonly bridge: NyteBridge;
  /** Connect with `sdk.connect` and route every read to this host; resolves with the host's id. */
  connect(connection: Connection, options?: ConnectOptions): Promise<HostId>;
}

const NOT_CONNECTED = "The app is not connected to a server.";

const SERVER = "Change servers from the connect screen.";

const REMOTE_ACCESS = "Remote access is turned on from the desktop app.";

const refuse = (message: string) => (): Promise<never> => Promise.reject(new Error(message));

/** `NodeJS.Platform` names the browser's OS, which is what shortcuts and chrome follow. */
function browserPlatform(): NodeJS.Platform {
  const name = `${navigator.platform} ${navigator.userAgent}`;

  if (/Mac|iPhone|iPad/i.test(name)) return "darwin";

  if (/Win/i.test(name)) return "win32";

  return "linux";
}

/** The page a link names when it is a web page; nothing else opens from the web app. */
export function webPageUrl(url: string): string | undefined {
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

  const openWorkspace = async ({ path }: { path: string }): Promise<OpenWorkspaceOutcome> => {
    try {
      const host = connected();
      const seen = await host.workspaces.inspect({ kind: "local", path });
      const added = await host.workspaces.add(seen.target, { expect: { identity: seen.identity } });

      if (added.kind === "stale")
        return { kind: "failed", message: "The folder changed. Try again." };

      if (added.kind === "unavailable")
        return { kind: "failed", message: "This folder is not available on the server." };
      selected = { id: added.workspace, path, name: workspaceName(seen) };
      emit({ kind: "workspace_opened", workspace: selected });

      return { kind: "opened", workspace: selected, needsTrust: false };
    } catch (cause) {
      return { kind: "failed", message: errorMessage(cause) };
    }
  };

  const bridge: NyteBridge = {
    clientSurface: "web",
    get relay() {
      return relay;
    },
    host: {
      onMenuCommand: () => () => undefined,
      setThemePreference: () => undefined,
      state: async () => ({ workspace: selected, platform: browserPlatform() }),
      endpoint: async () => {
        if (endpoint === undefined) throw new Error(NOT_CONNECTED);

        return endpoint;
      },
      fonts: () => Promise.resolve({ sans: [], monospace: [] }),
      openWorkspace,
      pickWorkspace: async (): Promise<OpenWorkspaceOutcome> => {
        const path = await requestFolderPath(connected().hostId);

        return path === undefined ? { kind: "cancelled" } : openWorkspace({ path });
      },
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
            tailnet: { kind: "missing" },
            cloudflare: { kind: "unregistered" },
          }),
        start: refuse(REMOTE_ACCESS),
        stop: refuse(REMOTE_ACCESS),
        configure: refuse(REMOTE_ACCESS),
        clear: refuse(REMOTE_ACCESS),
        pair: refuse(REMOTE_ACCESS),
        revoke: refuse(REMOTE_ACCESS),
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
      const next: HostEndpoint = {
        url,
        credentials: { kind: "token", token },
        ...(options?.expect === undefined ? {} : { expect: { hostId: options.expect } }),
      };
      let connecting = true;
      const opened = await connectHost(next, {
        fetch: (resource, init) =>
          fetch(resource, {
            ...init,
            credentials: "omit",
            signal: connecting ? (options?.signal ?? init?.signal) : init?.signal,
          }),
      });
      connecting = false;
      await connection?.close();
      connection = opened;
      endpoint = next;
      relay = options?.relay;
      selected = undefined;

      return opened.hostId;
    },
  };
}
