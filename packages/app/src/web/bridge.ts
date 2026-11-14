import type { Connection as SdkConnection } from "@nyte-ai/sdk";
import type {
  NyteBridge,
  OpenWorkspaceOutcome,
  RegisterWorkspaceOutcome,
} from "../contract/bridge.ts";
import { registerFolder } from "../contract/register-folder.ts";
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
  readonly expect?: HostEndpoint["expect"];
}

export interface WebBridge {
  readonly bridge: NyteBridge;
  /** Connects and answers the host's id with the key it proved, which is absent for a host that answers no identity challenge. */
  connect(
    connection: Connection,
    options?: ConnectOptions,
  ): Promise<Pick<SdkConnection, "hostId" | "publicKey">>;
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

function keepUnsavedEdits(event: BeforeUnloadEvent): void {
  event.preventDefault();
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
  const pin = options?.expect;

  if (pin === undefined) return undefined;
  const url = await directRoute(pin.hostId);

  if (url === undefined) return undefined;

  const endpoint: HostEndpoint = {
    url,
    credentials: { kind: "custom", headers: () => ({}) },
    expect: pin,
  };

  const deadline = AbortSignal.timeout(DIRECT_MS);

  const signal =
    options?.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);

  return openEndpoint(endpoint, signal).then(
    (opened) => ({ endpoint, opened }),
    () => {
      if (options?.signal?.aborted !== true) holdRoute(pin.hostId);

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

  const connected = (): SdkConnection => {
    if (connection === undefined) throw new Error(NOT_CONNECTED);

    return connection;
  };

  const registerWorkspace = ({ path }: { path: string }): Promise<RegisterWorkspaceOutcome> =>
    registerFolder(async () => connected(), path, false);

  const openWorkspace = async (input: { path: string }): Promise<OpenWorkspaceOutcome> => {
    const registered = await registerWorkspace(input);

    return registered.kind === "failed"
      ? registered
      : { kind: "opened", workspace: registered.workspace, needsTrust: registered.needsTrust };
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
      setUnsavedEdits: (held) => {
        if (held) window.addEventListener("beforeunload", keepUnsavedEdits);
        else window.removeEventListener("beforeunload", keepUnsavedEdits);
      },
      onEvent: () => () => undefined,
    },
  };

  return {
    bridge,
    connect: async ({ url, token }, options) => {
      const chosen: HostEndpoint = {
        url,
        credentials: { kind: "token", token },
        expect: options?.expect,
      };

      const direct = await openDirect(options);
      const next = direct?.endpoint ?? chosen;
      const opened = direct?.opened ?? (await openEndpoint(chosen, options?.signal));

      await connection?.close();
      connection = opened;
      endpoint = next;
      relay = direct === undefined ? options?.relay : undefined;
      noteDirect(direct !== undefined);

      return opened;
    },
  };
}
