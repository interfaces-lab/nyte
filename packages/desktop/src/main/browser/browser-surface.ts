import type { BrowserWindow, Session, WebContents } from "electron";
import type {
  BrowserDesign,
  BrowserFindResult,
  BrowserGuest,
  BrowserKey,
  BrowserSurfaceState,
  HostEvent,
} from "@nyte-ai/app/contract/bridge.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { BrowserHistoryStore } from "./browser-history.ts";
import { holderKey } from "../../shared/browser-agent.ts";
import type { BrowserHolder, BrowserOwner } from "../../shared/browser-agent.ts";
import { surfaceSecurity } from "./browser-policy.ts";
import type { SurfaceRuntime } from "./browser-runtime.ts";
import type { HostWindow } from "../../shared/host-window.ts";

export interface GuestSession {
  readonly session: Session;
  readonly partition: string;
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

export interface HostingWindow {
  readonly id: HostWindow;
  readonly window: BrowserWindow;
}

export interface Surface {
  readonly id: string;
  readonly holders: Map<string, BrowserHolder>;
  readonly runtime: SurfaceRuntime;
  readonly guestSession: GuestSession;
  guest: WebContents | undefined;
  readonly waiting: Set<(guest: WebContents | undefined) => void>;
  generation: number;
  address: string | undefined;
  zoom: number;
  visible: boolean;
  home: HostWindow | undefined;
  host: HostingWindow | undefined;
  destroyed: boolean;
  operations: number;
  captures: number;
  lastUse: number;
  blocked: number;
  error: BrowserSurfaceState["error"];
  owner: BrowserOwner;
  fullscreen: boolean;
  windowWasWindowed: boolean;
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
  design: BrowserDesign;
  entered: boolean;
  published:
    | { readonly state: BrowserSurfaceState; readonly window: HostWindow | undefined }
    | undefined;
}

export interface SurfaceRegistry {
  readonly dependencies: BrowserSurfacesDependencies;
  blocking(url: string): BrowserSurfaceState["blocking"];
  blockedStyles(url: string): string;
  publish(surface: Surface): void;
  notify(surface: Surface, event: HostEvent): void;
  load(surface: Surface, url: string): void;
  remember(surface: Surface, url: string): void;
  reclaimIdle(): void;
  forwardKey(surface: Surface, contents: WebContents, key: BrowserKey): void;
}

export function countHolders(
  surface: Pick<Surface, "holders">,
  kind: BrowserHolder["kind"],
): number {
  let count = 0;

  for (const holder of surface.holders.values()) {
    if (holder.kind === kind) count += 1;
  }

  return count;
}

export function followsTabPolicy(surface: Pick<Surface, "holders">): boolean {
  return countHolders(surface, "tab") > 0 && countHolders(surface, "board") === 0;
}

type HeldPage = Pick<Surface, "holders" | "home" | "visible">;

export function reportVisibility(
  page: HeldPage,
  window: HostWindow,
  visible: boolean,
): "ignored" | "kept" | "moved" {
  if (page.home === window) {
    page.visible = visible;

    return "kept";
  }

  if (!visible) return "ignored";
  page.home = window;
  page.visible = true;

  return "moved";
}

export function dropHolder(page: HeldPage, holder: BrowserHolder): "absent" | "held" | "unheld" {
  if (!page.holders.delete(holderKey(holder))) return "absent";

  return page.holders.size === 0 ? "unheld" : "held";
}

export function dropWindowHolders(
  page: HeldPage,
  window: HostWindow,
): ReturnType<typeof dropHolder> {
  const dropped = [
    page.holders.delete(holderKey({ kind: "tab", window })),
    page.holders.delete(holderKey({ kind: "board", window })),
  ];

  if (!dropped.includes(true)) return "absent";

  return page.holders.size === 0 ? "unheld" : "held";
}

export function leaveWindow(page: HeldPage, window: HostWindow): ReturnType<typeof dropHolder> {
  if (page.home === window) {
    page.home = undefined;
    page.visible = false;
  }

  return dropWindowHolders(page, window);
}

export function pageAddress(surface: Surface): string | undefined {
  const contents = surface.guest;

  return contents === undefined || contents.isDestroyed() ? surface.address : contents.getURL();
}

export function surfaceState(
  surface: Surface,
  blocking: (url: string) => BrowserSurfaceState["blocking"],
): BrowserSurfaceState {
  const contents = surface.guest;
  const agentHolders = countHolders(surface, "session");

  if (contents === undefined || contents.isDestroyed()) {
    const url = surface.address ?? "";

    return {
      url,
      title: "",
      loading: url !== "" && surface.error === undefined,
      canGoBack: false,
      canGoForward: false,
      secure: surfaceSecurity(url),
      blocking: blocking(url),
      blocked: surface.blocked,
      error: surface.error,
      agentHolders,
      fullscreen: false,
      deniedPermissions: [...surface.deniedPermissions],
      design: surface.design,
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
    design: surface.design,
  };
}

export function surfaceGuest(surface: Surface): BrowserGuest {
  return {
    surface: surface.id,
    partition: surface.guestSession.partition,
    generation: surface.generation,
    painting: surface.operations > 0 || surface.captures > 0,
  };
}
