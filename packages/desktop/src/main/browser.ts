import { WebContentsView, webContents } from "electron";
import { Value } from "typebox/value";
import type { WebContents } from "electron";
import { showBrowserMenu, performBrowserAction } from "./browser-actions.ts";
import type {
  BrowserBoundsMessage,
  BrowserBridge,
  BrowserElementPick,
  BrowserFocusMessage,
  BrowserKey,
  BrowserNavigationAction,
  BrowserSurfaceState,
  HostEvent,
} from "@nyte-ai/app/bridge.ts";
import { SurfaceAgent } from "./browser-agent-surface.ts";
import type { AgentSurfaces } from "./browser-agent-surface.ts";
import type { BrowserAgent, BrowserHolder, BrowserOwner } from "./browser-agent.ts";
import { BrowserDownloads } from "./browser-downloads.ts";
import { GuestSessions } from "./browser-guest-session.ts";
import { pickElement } from "./browser-picker.ts";
import { nextZoomFactor, webUrl } from "./browser-policy.ts";
import { createSurfaceRuntime } from "./browser-runtime.ts";
import { DEFAULT_BOUNDS, hasViewHolder, placeSurface, surfaceState } from "./browser-surface.ts";
import type { BrowserSurfacesDependencies, Surface, SurfaceRegistry } from "./browser-surface.ts";
import { wireSurface } from "./browser-surface-events.ts";
import { ExpectedHostError } from "./errors.ts";
import type { HostWindow } from "./host-window.ts";

const WARM_POOL_LIMIT = 6;

const FRAME_QUALITY = 80;

function readOwner(path: string | null): BrowserOwner {
  return path === null ? { kind: "home" } : { kind: "project", path };
}

function ownerPath(owner: BrowserOwner): string | null {
  return owner.kind === "home" ? null : owner.path;
}

function reclaimable(surface: Surface): boolean {
  if (surface.operations > 0 || surface.visible || hasViewHolder(surface)) return false;

  const contents = surface.view.webContents;

  return contents.isDestroyed() || !contents.isLoading();
}

export class BrowserSurfaces implements SurfaceRegistry, AgentSurfaces {
  readonly dependencies: BrowserSurfacesDependencies;
  readonly agent: BrowserAgent = new SurfaceAgent(this);
  readonly #surfaces = new Map<string, Surface>();
  readonly #byWebContents = new Map<number, Surface>();
  readonly #downloads: BrowserDownloads;
  readonly #guests: GuestSessions;
  readonly #chromeFocus = new Map<HostWindow, string>();
  #useClock = 0;

  constructor(dependencies: BrowserSurfacesDependencies) {
    this.dependencies = dependencies;
    this.#downloads = new BrowserDownloads((surface, event) => this.notify(surface, event));
    this.#guests = new GuestSessions({
      dependencies,
      downloads: this.#downloads,
      surface: (id) => this.#byWebContents.get(id),
      publish: (surface) => this.publish(surface),
    });
    dependencies.history.listen((owner, entries) =>
      dependencies.emit({ kind: "browser_history_changed", owner, entries }),
    );
  }

  emit(event: HostEvent): void {
    this.dependencies.emit(event);
  }

  blocking(url: string): BrowserSurfaceState["blocking"] {
    return this.#guests.blocking(url);
  }

  blockedStyles(url: string): string {
    return this.#guests.blockedStyles(url);
  }

  surface(id: string): Surface | undefined {
    return this.#surfaces.get(id);
  }

  retain(id: string, holder: BrowserHolder, owner: BrowserOwner): Surface {
    const surface = this.#surfaces.get(id) ?? this.#create(id, owner);
    surface.holders.add(holder);

    return surface;
  }

  release(id: string, holder: BrowserHolder): void {
    const surface = this.#surfaces.get(id);

    if (surface === undefined) return;
    surface.holders.delete(holder);

    if (surface.holders.size === 0) {
      this.#destroy(surface);

      return;
    }

    this.place(surface);
    this.reclaimIdle();
  }

  place(surface: Surface, focus = false): void {
    if (surface.destroyed) return;
    const window = this.dependencies.window(surface.home);

    if (window === undefined || window.isDestroyed()) return;
    placeSurface(surface, window, focus);
  }

  publish(surface: Surface): void {
    if (surface.destroyed) return;
    const state = surfaceState(surface, (url) => this.blocking(url));
    const published = surface.published;

    if (
      published !== undefined &&
      published.window === surface.home &&
      Value.Equal(published.state, state)
    )
      return;
    surface.published = { state, window: surface.home };
    this.notify(surface, { kind: "browser_changed", surface: surface.id, state });
  }

  notify(surface: Surface, event: HostEvent): void {
    this.dependencies.emit(event, surface.home);
  }

  load(surface: Surface, url: string): void {
    surface.error = undefined;
    void this.#guests.ensureBlocker().then(() => {
      const contents = surface.view.webContents;

      if (surface.destroyed || contents.isDestroyed()) return undefined;

      return contents.loadURL(url).catch(() => undefined);
    });
  }

  remember(surface: Surface, url: string): void {
    const page = webUrl(url);

    if (page === undefined || surface.destroyed || !hasViewHolder(surface)) return;
    surface.visited = page;
    void this.dependencies.history.record(surface.owner, { url: page, at: Date.now() });
  }

  reclaimIdle(): void {
    const idle = [...this.#surfaces.values()]
      .filter(reclaimable)
      .sort((a, b) => a.lastUse - b.lastUse);

    for (const surface of idle.slice(0, Math.max(0, idle.length - WARM_POOL_LIMIT))) {
      this.#destroy(surface);
    }
  }

  touch(surface: Surface): void {
    surface.lastUse = ++this.#useClock;
  }

  windowShown(surface: Surface): boolean {
    const window = surface.attachedTo;

    return window !== undefined && !window.isDestroyed() && this.dependencies.windowShown(window);
  }

  forwardKey(surface: Surface, contents: WebContents, key: BrowserKey): void {
    if (surface.destroyed || surface.home === undefined) return;
    this.dependencies.forwardKey({ surface: surface.id, window: surface.home, contents, key });
  }

  open(
    input: { readonly surface: string; readonly url: string; readonly owner?: BrowserOwner },
    window: HostWindow,
  ): BrowserSurfaceState {
    const target = webUrl(input.url);

    if (target === undefined)
      throw new ExpectedHostError({
        code: "invalid",
        message: "Only web addresses open in the browser panel.",
      });

    const surface = this.retain(
      input.surface,
      `view:${input.surface}`,
      input.owner ?? { kind: "home" },
    );

    surface.home = window;

    const contents = surface.view.webContents;

    if (contents.getURL() !== target || surface.error !== undefined) this.load(surface, target);
    this.place(surface);
    const state = surfaceState(surface, (url) => this.blocking(url));
    surface.published = { state, window };

    return state;
  }

  navigate(input: { readonly surface: string; readonly action: BrowserNavigationAction }): void {
    const surface = this.#surfaces.get(input.surface);

    if (surface === undefined) return;
    const contents = surface.view.webContents;

    if (contents.isDestroyed()) return;
    const action = input.action;

    switch (action) {
      case "back":
        contents.navigationHistory.goBack();

        return;
      case "forward":
        contents.navigationHistory.goForward();

        return;
      case "reload":
        surface.error = undefined;
        contents.reload();

        return;
      case "hard-reload":
        surface.error = undefined;
        contents.reloadIgnoringCache();

        return;
      case "stop":
        contents.stop();

        return;
      case "trust-certificate": {
        const host = surface.untrustedHost;

        if (host === undefined) return;
        surface.guestSession.trustedCertificateHosts.add(host);
        surface.untrustedHost = undefined;
        surface.error = undefined;
        contents.reload();

        return;
      }

      case "zoom-in":
      case "zoom-out":
        contents.setZoomFactor(
          nextZoomFactor(contents.getZoomFactor(), action === "zoom-in" ? "in" : "out"),
        );

        return;
      case "zoom-reset":
        contents.setZoomFactor(1);

        return;
      case "toggle-devtools":
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else contents.openDevTools({ mode: "detach" });

        return;

      default: {
        const _exhaustive: never = action;

        return _exhaustive;
      }
    }
  }

  async menu(
    input: Parameters<BrowserBridge["menu"]>[0],
    window: HostWindow,
  ): ReturnType<BrowserBridge["menu"]> {
    const surface = this.#surfaces.get(input.surface);
    const contents = surface?.view.webContents;
    const hasPage = contents !== undefined && !contents.isDestroyed() && contents.getURL() !== "";

    return showBrowserMenu({
      window: this.dependencies.window(window),
      hasPage,
      owner: surface?.owner ?? readOwner(input.owner),
      input,
    });
  }

  async perform(
    input: Parameters<BrowserBridge["perform"]>[0],
    window: HostWindow,
  ): ReturnType<BrowserBridge["perform"]> {
    const surface = this.#surfaces.get(input.surface);
    const owner = surface?.owner ?? readOwner(input.owner);

    if (input.action === "clear-history") {
      await this.dependencies.history.clear(owner);

      for (const other of this.#surfaces.values()) {
        const contents = other.view.webContents;

        if (ownerPath(other.owner) !== ownerPath(owner) || contents.isDestroyed()) continue;
        contents.navigationHistory.clear();
        other.visited = undefined;
        this.publish(other);
      }

      return;
    }

    return performBrowserAction({
      action: input.action,
      contents: surface?.view.webContents,
      guest: this.#guests.forOwner(owner).session,
      window: this.dependencies.window(window),
    });
  }

  close(input: { readonly surface: string }): void {
    this.release(input.surface, `view:${input.surface}`);
  }

  async captureFrame(input: { readonly surface: string }): Promise<string | undefined> {
    const surface = this.#surfaces.get(input.surface);

    if (surface === undefined) return undefined;
    const contents = surface.view.webContents;

    if (contents.isDestroyed() || contents.getURL() === "") return undefined;

    try {
      const image = await contents.capturePage(undefined, { stayHidden: true });

      if (image.isEmpty()) return undefined;
      const width = Math.min(image.getSize().width, surface.view.getBounds().width);
      const frame = image.resize({ width, quality: "good" }).toJPEG(FRAME_QUALITY);

      return `data:image/jpeg;base64,${frame.toString("base64")}`;
    } catch {
      return undefined;
    }
  }

  pickElement(input: { readonly surface: string }): Promise<BrowserElementPick | undefined> {
    const contents = this.#surfaces.get(input.surface)?.view.webContents;

    if (contents === undefined || contents.isDestroyed() || contents.getURL() === "")
      return Promise.resolve(undefined);
    contents.focus();

    return pickElement(contents);
  }

  find(input: Parameters<BrowserBridge["find"]>[0]): ReturnType<BrowserBridge["find"]> {
    const surface = this.#surfaces.get(input.surface);
    const contents = surface?.view.webContents;
    const none = { active: 0, total: 0 };

    if (surface === undefined || contents === undefined || contents.isDestroyed())
      return Promise.resolve(none);
    surface.find?.resolve(none);
    surface.find = undefined;

    if (input.text === "") {
      surface.findText = "";
      contents.stopFindInPage("clearSelection");

      return Promise.resolve(none);
    }

    return new Promise((resolve) => {
      const request = contents.findInPage(input.text, {
        forward: input.direction === "next",
        findNext: input.text !== surface.findText,
        matchCase: false,
      });

      surface.findText = input.text;
      surface.find = { request, resolve };
    });
  }

  cancelDownload(input: { readonly surface: string; readonly id: string }): void {
    this.#downloads.cancel(input.id);
  }

  login(input: Parameters<BrowserBridge["login"]>[0]): void {
    const surface = this.#surfaces.get(input.surface);
    const answer = surface?.login;

    if (surface === undefined || answer === undefined) return;
    surface.login = undefined;

    if (input.credentials === undefined) answer();
    else answer(input.credentials.username, input.credentials.password);
  }

  history(input: Parameters<BrowserBridge["history"]>[0]): ReturnType<BrowserBridge["history"]> {
    return this.dependencies.history.entries(readOwner(input.owner));
  }

  forgetHistory(
    input: Parameters<BrowserBridge["forgetHistory"]>[0],
  ): ReturnType<BrowserBridge["forgetHistory"]> {
    return this.dependencies.history.remove(readOwner(input.owner), input.url);
  }

  setBounds(message: BrowserBoundsMessage, window: HostWindow): void {
    const surface = this.#surfaces.get(message.surface);

    if (surface === undefined) return;
    const moved = message.visible && surface.home !== window;

    if (moved) surface.home = window;

    const bounds = {
      x: Math.round(message.bounds.x),
      y: Math.round(message.bounds.y),
      width: Math.round(message.bounds.width),
      height: Math.round(message.bounds.height),
    };

    surface.bounds = bounds;
    surface.visible = message.visible;

    if (bounds.width > 0 && bounds.height > 0) surface.lastBounds = bounds;

    this.place(surface, message.focus);

    if (moved) this.publish(surface);
  }

  setFocus(message: BrowserFocusMessage, window: HostWindow): void {
    if (!message.focused) {
      if (this.#chromeFocus.get(window) === message.surface) this.#chromeFocus.delete(window);

      return;
    }

    this.#chromeFocus.set(window, message.surface);
    const host = this.dependencies.window(window);

    if (host !== undefined && !host.isDestroyed() && !host.webContents.isFocused())
      host.webContents.focus();
  }

  focused(window: HostWindow | undefined): string | undefined {
    const focusedContents = webContents.getFocusedWebContents();

    if (focusedContents) {
      for (const surface of this.#surfaces.values()) {
        const contents = surface.view.webContents;

        if (contents.isDestroyed()) continue;

        if (contents === focusedContents || contents.devToolsWebContents === focusedContents)
          return surface.id;
      }
    }

    return window === undefined ? undefined : this.#chromeFocus.get(window);
  }

  settingsChanged(): void {
    for (const surface of this.#surfaces.values()) this.publish(surface);
  }

  releaseWindow(window: HostWindow): void {
    this.#chromeFocus.delete(window);

    for (const surface of this.#surfaces.values()) {
      if (surface.home !== window) continue;
      surface.home = undefined;
      surface.attachedTo = undefined;
      this.release(surface.id, `view:${surface.id}`);
    }
  }

  #create(id: string, owner: BrowserOwner): Surface {
    const guestSession = this.#guests.forOwner(owner);

    const view = new WebContentsView({
      webPreferences: {
        session: guestSession.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });

    const surface: Surface = {
      id,
      view,
      holders: new Set(),
      lastBounds: DEFAULT_BOUNDS,
      runtime: createSurfaceRuntime(),
      guestSession,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      visible: false,
      home: undefined,
      attachedTo: undefined,
      destroyed: false,
      operations: 0,
      lastUse: ++this.#useClock,
      blocked: 0,
      error: undefined,
      owner,
      fullscreen: false,
      windowWasWindowed: false,
      onWindowResize: undefined,
      find: undefined,
      findText: "",
      deniedPermissions: new Set(),
      login: undefined,
      untrustedHost: undefined,
      crashes: [],
      popup: undefined,
      visited: undefined,
      paused: false,
      pressed: [],
      published: undefined,
    };

    this.#surfaces.set(id, surface);
    this.#byWebContents.set(view.webContents.id, surface);
    wireSurface(this, surface);

    return surface;
  }

  #destroy(surface: Surface): void {
    if (surface.destroyed) return;
    surface.destroyed = true;
    this.#surfaces.delete(surface.id);

    for (const [window, id] of this.#chromeFocus) {
      if (id === surface.id) this.#chromeFocus.delete(window);
    }

    const contents = surface.view.webContents;
    this.#byWebContents.delete(contents.id);
    surface.guestSession.upgrades.delete(contents.id);
    surface.find?.resolve({ active: 0, total: 0 });
    surface.find = undefined;
    surface.login?.();
    surface.login = undefined;

    if (surface.popup !== undefined && !surface.popup.isDestroyed()) surface.popup.close();
    surface.popup = undefined;
    const window = surface.attachedTo;

    if (window !== undefined && !window.isDestroyed()) {
      if (surface.onWindowResize !== undefined) window.off("resize", surface.onWindowResize);

      if (surface.windowWasWindowed) window.setFullScreen(false);
      window.contentView.removeChildView(surface.view);
    }

    surface.attachedTo = undefined;

    if (!contents.isDestroyed()) contents.close();
  }
}
