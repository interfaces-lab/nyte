import type { BrowserWindow, Session, WebContents, WebContentsView } from "electron";
import type {
  BrowserBoundsMessage,
  BrowserFindResult,
  BrowserKey,
  BrowserSurfaceState,
  HostEvent,
} from "@nyte-ai/app/bridge.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import type { BrowserHistoryStore } from "./browser-history.ts";
import type { BrowserHolder, BrowserOwner, BrowserRect } from "./browser-agent.ts";
import { surfaceSecurity } from "./browser-policy.ts";
import type { SurfaceRuntime } from "./browser-runtime.ts";
import type { HostWindow } from "./host-window.ts";

export interface GuestSession {
  readonly session: Session;
  readonly plainHosts: Set<string>;
  readonly upgrades: Map<number, string>;
  readonly trustedCertificateHosts: Set<string>;
}

export interface BrowserSurfacesDependencies {
  readonly window: (id: HostWindow | undefined) => BrowserWindow | undefined;
  readonly emit: (event: HostEvent, window?: HostWindow) => void;
  readonly filterListPath: string;
  readonly windowShown: (window: BrowserWindow) => boolean;
  readonly settings: () => Pick<
    DesktopSettings,
    "blockAds" | "adblockAllowedHosts" | "upgradeToHttps"
  >;
  readonly history: BrowserHistoryStore;
  readonly pagePreload: string;
  readonly forwardKey: (input: {
    readonly surface: string;
    readonly window: HostWindow;
    readonly contents: WebContents;
    readonly key: BrowserKey;
  }) => void;
}

export interface Surface {
  readonly id: string;
  readonly view: WebContentsView;
  readonly holders: Set<BrowserHolder>;
  lastBounds: BrowserRect;
  readonly runtime: SurfaceRuntime;
  readonly guestSession: GuestSession;
  bounds: BrowserBoundsMessage["bounds"];
  visible: boolean;
  home: HostWindow | undefined;
  attachedTo: BrowserWindow | undefined;
  destroyed: boolean;
  operations: number;
  lastUse: number;
  blocked: number;
  error: BrowserSurfaceState["error"];
  owner: BrowserOwner;
  fullscreen: boolean;
  windowWasWindowed: boolean;
  onWindowResize: (() => void) | undefined;
  find:
    | { readonly request: number; readonly resolve: (result: BrowserFindResult) => void }
    | undefined;
  findText: string;
  readonly deniedPermissions: Set<string>;
  login: ((username?: string, password?: string) => void) | undefined;
  untrustedHost: string | undefined;
  readonly crashes: number[];
  popup: BrowserWindow | undefined;
  visited: string | undefined;
  paused: boolean;
  readonly pressed: BrowserKey[];
  published:
    | { readonly state: BrowserSurfaceState; readonly window: HostWindow | undefined }
    | undefined;
}

export interface SurfaceRegistry {
  readonly dependencies: BrowserSurfacesDependencies;
  blocking(url: string): BrowserSurfaceState["blocking"];
  blockedStyles(url: string): string;
  place(surface: Surface): void;
  publish(surface: Surface): void;
  notify(surface: Surface, event: HostEvent): void;
  load(surface: Surface, url: string): void;
  remember(surface: Surface, url: string): void;
  reclaimIdle(): void;
  forwardKey(surface: Surface, contents: WebContents, key: BrowserKey): void;
}

export const DEFAULT_BOUNDS: BrowserRect = { x: 0, y: 0, width: 1280, height: 800 };

export function hasViewHolder(surface: Surface): boolean {
  for (const holder of surface.holders) {
    if (holder.startsWith("view:")) return true;
  }

  return false;
}

export function countSessionHolders(surface: Surface): number {
  let count = 0;

  for (const holder of surface.holders) {
    if (holder.startsWith("session:")) count += 1;
  }

  return count;
}

export function surfaceState(
  surface: Surface,
  blocking: (url: string) => BrowserSurfaceState["blocking"],
): BrowserSurfaceState {
  const contents = surface.view.webContents;
  const agentHolders = countSessionHolders(surface);

  if (contents.isDestroyed()) {
    return {
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      secure: "none",
      blocking: "off",
      blocked: surface.blocked,
      error: surface.error,
      agentHolders,
      fullscreen: false,
      deniedPermissions: [],
    };
  }

  const url = contents.getURL();

  return {
    url,
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    secure: surfaceSecurity(url),
    blocking: blocking(url),
    blocked: surface.blocked,
    error: surface.error,
    agentHolders,
    fullscreen: surface.fullscreen,
    deniedPermissions: [...surface.deniedPermissions],
  };
}

function hide(surface: Surface, window: BrowserWindow): void {
  const contents = surface.view.webContents;
  const held = !contents.isDestroyed() && contents.isFocused();
  surface.view.setVisible(false);

  if (held) window.webContents.focus();
}

function show(surface: Surface, focus: boolean): void {
  surface.view.setVisible(true);

  if (focus) surface.view.webContents.focus();
}

export function placeSurface(surface: Surface, window: BrowserWindow, focus: boolean): void {
  if (surface.attachedTo !== window) {
    if (surface.attachedTo !== undefined && !surface.attachedTo.isDestroyed()) {
      surface.attachedTo.contentView.removeChildView(surface.view);
    }

    window.contentView.addChildView(surface.view);
    surface.attachedTo = window;
  }

  const placed = hasViewHolder(surface) && surface.bounds.width > 0 && surface.bounds.height > 0;

  if (surface.fullscreen && placed) {
    const { width, height } = window.getContentBounds();
    surface.view.setBounds({ x: 0, y: 0, width, height });
    show(surface, focus);

    return;
  }

  if (!placed) {
    hide(surface, window);
    surface.view.setBounds({
      x: -10000,
      y: -10000,
      width: surface.lastBounds.width > 0 ? surface.lastBounds.width : DEFAULT_BOUNDS.width,
      height: surface.lastBounds.height > 0 ? surface.lastBounds.height : DEFAULT_BOUNDS.height,
    });

    return;
  }

  surface.view.setBounds(surface.bounds);

  if (surface.visible && surface.error === undefined) show(surface, focus);
  else hide(surface, window);
}
