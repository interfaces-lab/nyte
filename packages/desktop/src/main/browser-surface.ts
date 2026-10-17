/** One browser panel page: its native view, why it is alive, and where it is placed. */
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

/** Per-workspace guest session: its own cookie jar and storage. */
export interface GuestSession {
  readonly session: Session;
  readonly plainHosts: Set<string>;
  readonly upgrades: Map<number, string>;
  readonly trustedCertificateHosts: Set<string>;
}

export interface BrowserSurfacesDependencies {
  /** The open window with this id, or the last focused one when it is gone or unset. */
  readonly window: (id: HostWindow | undefined) => BrowserWindow | undefined;
  /** Push a host event to one window, or to every window when `window` is omitted. */
  readonly emit: (event: HostEvent, window?: HostWindow) => void;
  readonly filterListPath: string;
  /** Whether the window has been shown at least once. Mouse input is dropped until then. */
  readonly windowShown: (window: BrowserWindow) => boolean;
  /** Read per request, so a changed setting applies to the next one. */
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
  /** A surface stays alive while at least one holder retains it. */
  readonly holders: Set<BrowserHolder>;
  /** The last real size, so a parked page keeps a usable viewport. */
  lastBounds: BrowserRect;
  readonly runtime: SurfaceRuntime;
  readonly guestSession: GuestSession;
  bounds: BrowserBoundsMessage["bounds"];
  visible: boolean;
  /** The window whose panel last showed this page; agent-only pages have none. */
  home: HostWindow | undefined;
  /** The window the view is a child of. */
  attachedTo: BrowserWindow | undefined;
  /** Set once by destroy. Native events still arrive afterwards and must not touch state. */
  destroyed: boolean;
  /** Agent operations in flight. Throttling is off only while this is above zero. */
  operations: number;
  /** Tick of the last agent operation, so reclamation drops the longest-idle page first. */
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
  /** The state the renderer last received and where it went, so an unchanged state is not resent. */
  published:
    | { readonly state: BrowserSurfaceState; readonly window: HostWindow | undefined }
    | undefined;
}

/** What the surface modules need from the registry that owns every surface. */
export interface SurfaceRegistry {
  readonly dependencies: BrowserSurfacesDependencies;
  /** Ad blocking for this url right now, from the settings and the loaded filter engine. */
  blocking(url: string): BrowserSurfaceState["blocking"];
  /** Cosmetic filter styles for this url, or "" when blocking is off. */
  blockedStyles(url: string): string;
  place(surface: Surface): void;
  publish(surface: Surface): void;
  /** Send a surface's event to the window showing it, or to every window when none does. */
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

/**
 * A hidden page keeps keyboard focus unless it is handed back, which leaves a
 * menu that just opened over the page unable to receive arrow keys.
 */
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

/**
 * Attach the view to `window` and lay it out from the surface's bounds, visibility, and holders.
 * A zero-sized view lays the page out at a 0-wide viewport, which changes what is visible and
 * ruins screenshots, so an unplaced or unmeasured surface is parked off-screen at a real size.
 * `focus` hands the page keyboard focus when this shows it.
 */
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
