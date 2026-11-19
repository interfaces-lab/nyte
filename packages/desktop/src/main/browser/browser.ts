import { webContents } from "electron";
import { Value } from "typebox/value";
import type { BrowserWindow, WebContents, WebPreferences } from "electron";
import { showBrowserMenu, performBrowserAction } from "./browser-actions.ts";
import type {
  BrowserBridge,
  BrowserCapture,
  BrowserDesignChange,
  BrowserFocusMessage,
  BrowserGuest,
  BrowserKey,
  BrowserNavigationAction,
  BrowserShownMessage,
  BrowserSurfaceState,
  HostEvent,
} from "@nyte-ai/app/contract/bridge.ts";
import { NO_DESIGN } from "@nyte-ai/app/contract/bridge.ts";
import { SurfaceAgent } from "./browser-agent-surface.ts";
import type { AgentSurfaces } from "./browser-agent-surface.ts";
import { holderKey } from "../../shared/browser-agent.ts";
import type { BrowserAgent, BrowserHolder, BrowserOwner } from "../../shared/browser-agent.ts";
import { BrowserDownloads } from "./browser-downloads.ts";
import { GuestSessions } from "./browser-guest-session.ts";
import { changeDesign } from "./browser-design.ts";
import { nextZoomFactor, webUrl } from "./browser-policy.ts";
import { capturePageRetrying, createSurfaceRuntime } from "./browser-runtime.ts";
import {
  dropHolder,
  dropWindowHolders,
  followsTabPolicy,
  leaveWindow,
  pageAddress,
  reportVisibility,
  surfaceGuest,
  surfaceState,
} from "./browser-surface.ts";
import type { BrowserSurfacesDependencies, Surface, SurfaceRegistry } from "./browser-surface.ts";
import { enterBoard, guardGuest, wireSurface } from "./browser-surface-events.ts";
import { ExpectedHostError } from "../../shared/errors.ts";
import { WINDOW_ZOOM_CHANNEL } from "../../shared/ipc.ts";
import type { HostWindow } from "../../shared/host-window.ts";

const WARM_POOL_LIMIT = 6;

const FRAME_QUALITY = 80;

const GUEST_WAIT_MS = 10_000;

const UNBOUND_GUEST_MS = 5_000;

function readOwner(path: string | null): BrowserOwner {
  return path === null ? { kind: "home" } : { kind: "project", path };
}

function ownerPath(owner: BrowserOwner): string | null {
  return owner.kind === "home" ? null : owner.path;
}

function reclaimable(surface: Surface): boolean {
  if (
    surface.operations > 0 ||
    surface.captures > 0 ||
    surface.visible ||
    [...surface.holders.values()].some((holder) => holder.kind !== "session")
  )
    return false;

  const contents = surface.guest;

  return contents === undefined || contents.isDestroyed() || !contents.isLoading();
}

function pinPreferences(preferences: WebPreferences, forced: WebPreferences): void {
  // oxlint-disable-next-line no-restricted-globals -- genuine reflection: it drops keys the type does not name, such as Electron's disablePopups
  for (const key of Reflect.ownKeys(preferences)) Reflect.deleteProperty(preferences, key);
  Object.assign(preferences, forced);
}

export class BrowserSurfaces implements SurfaceRegistry, AgentSurfaces {
  readonly dependencies: BrowserSurfacesDependencies;
  readonly agent: BrowserAgent = new SurfaceAgent(this);
  readonly #surfaces = new Map<string, Surface>();
  readonly #byWebContents = new Map<number, Surface>();
  readonly #downloads: BrowserDownloads;
  readonly #guests: GuestSessions;
  readonly #chromeFocus = new Map<HostWindow, string>();
  readonly #announced = new Map<HostWindow, readonly BrowserGuest[]>();
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
    surface.holders.set(holderKey(holder), holder);

    return surface;
  }

  release(id: string, holder: BrowserHolder): void {
    const surface = this.#surfaces.get(id);

    if (surface !== undefined) this.#released(surface, dropHolder(surface, holder));
  }

  place(surface: Surface): void {
    this.#rehost(surface, undefined);
  }

  #rehost(surface: Surface, away: HostWindow | undefined): void {
    if (surface.destroyed) return;
    const current = surface.host;

    const kept =
      surface.home === undefined && current !== undefined && !current.window.isDestroyed();

    const window = this.dependencies.window(surface.home);

    const found =
      window === undefined || window.isDestroyed() || window.webContents.id === away
        ? undefined
        : { id: window.webContents.id, window };

    const wanted = kept ? current : found;

    if (wanted?.id !== current?.id) {
      this.#unbind(surface);
      surface.host = wanted;

      if (current !== undefined) surface.generation += 1;
    }

    this.#announce();
  }

  guest(surface: Surface, signal?: AbortSignal): Promise<WebContents | undefined> {
    const bound = surface.guest;

    if (bound !== undefined && !bound.isDestroyed()) return Promise.resolve(bound);

    if (surface.destroyed || signal?.aborted) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      const settle = (guest: WebContents | undefined): void => {
        clearTimeout(timer);
        surface.waiting.delete(settle);
        signal?.removeEventListener("abort", abort);
        resolve(guest);
      };

      const abort = (): void => settle(undefined);
      const timer = setTimeout(abort, GUEST_WAIT_MS);

      surface.waiting.add(settle);
      signal?.addEventListener("abort", abort, { once: true });
    });
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
    void this.#navigate(surface, url);
  }

  #navigate(surface: Surface, url: string): Promise<void> {
    surface.error = undefined;
    surface.address = url;
    const contents = surface.guest;

    if (contents === undefined) return Promise.resolve();

    const go = (): void => {
      if (surface.destroyed || surface.guest !== contents || contents.isDestroyed()) return;
      void contents.loadURL(url).catch(() => undefined);
    };

    if (this.#guests.blockerSettled()) {
      go();

      return Promise.resolve();
    }

    return this.#guests.ensureBlocker().then(go, go);
  }

  remember(surface: Surface, url: string): void {
    const page = webUrl(url);

    if (page === undefined || surface.destroyed || !followsTabPolicy(surface)) return;
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
    const window = surface.host?.window;

    return window !== undefined && !window.isDestroyed() && this.dependencies.windowShown(window);
  }

  forwardKey(surface: Surface, contents: WebContents, key: BrowserKey): void {
    if (surface.destroyed || surface.home === undefined) return;
    this.dependencies.forwardKey({ surface: surface.id, window: surface.home, contents, key });
  }

  open(
    input: {
      readonly surface: string;
      readonly url: string;
      readonly owner?: BrowserOwner;
      readonly holder: Parameters<BrowserBridge["open"]>[0]["holder"];
    },
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
      { kind: input.holder, window },
      input.owner ?? { kind: "home" },
    );

    surface.home = window;

    if (pageAddress(surface) !== target || surface.error !== undefined) this.load(surface, target);
    this.place(surface);
    const state = surfaceState(surface, (url) => this.blocking(url));
    surface.published = { state, window };

    return state;
  }

  navigate(input: { readonly surface: string; readonly action: BrowserNavigationAction }): void {
    const surface = this.#surfaces.get(input.surface);

    const contents = surface?.guest;

    if (surface === undefined || contents === undefined || contents.isDestroyed()) return;
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
        surface.zoom = nextZoomFactor(
          contents.getZoomFactor(),
          action === "zoom-in" ? "in" : "out",
        );
        contents.setZoomFactor(surface.zoom);

        return;
      case "zoom-reset":
        surface.zoom = 1;
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
    const contents = surface?.guest;
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
        const contents = other.guest;

        if (
          ownerPath(other.owner) !== ownerPath(owner) ||
          contents === undefined ||
          contents.isDestroyed()
        )
          continue;
        contents.navigationHistory.clear();
        other.visited = undefined;
        this.publish(other);
      }

      return;
    }

    return performBrowserAction({
      action: input.action,
      contents: surface?.guest,
      guest: this.#guests.forOwner(owner).session,
      window: this.dependencies.window(window),
    });
  }

  close(input: { readonly surface: string }, window: HostWindow): void {
    const surface = this.#surfaces.get(input.surface);

    if (surface !== undefined) this.#released(surface, dropWindowHolders(surface, window));
  }

  async captureFrame(input: { readonly surface: string }): Promise<BrowserCapture | undefined> {
    const surface = this.#surfaces.get(input.surface);
    const contents = surface?.guest;

    if (surface === undefined || contents === undefined || contents.isDestroyed()) return undefined;
    const url = contents.getURL();
    const generation = surface.generation;

    if (url === "") return undefined;
    surface.captures += 1;
    this.#announce();

    try {
      const image = await capturePageRetrying(contents);

      if (image === undefined) return undefined;
      const size = image.getSize();

      return {
        src: `data:image/jpeg;base64,${image.toJPEG(FRAME_QUALITY).toString("base64")}`,
        generation,
        url,
        width: size.width,
        height: size.height,
      };
    } finally {
      surface.captures -= 1;
      this.#announce();
    }
  }

  design(input: { readonly surface: string; readonly change: BrowserDesignChange }): void {
    const surface = this.#surfaces.get(input.surface);

    if (surface !== undefined) changeDesign(this, surface, input.change);
  }

  find(input: Parameters<BrowserBridge["find"]>[0]): ReturnType<BrowserBridge["find"]> {
    const surface = this.#surfaces.get(input.surface);
    const contents = surface?.guest;
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

  guests(window: HostWindow): readonly BrowserGuest[] {
    for (const surface of this.#surfaces.values()) {
      if (surface.host === undefined) this.place(surface);
    }

    const guests = [...this.#surfaces.values()].flatMap((surface) =>
      surface.host?.id === window ? [surfaceGuest(surface)] : [],
    );

    this.#announced.set(window, guests);

    return guests;
  }

  attach(input: Parameters<BrowserBridge["attach"]>[0], window: HostWindow): void {
    const surface = this.#surfaces.get(input.surface);
    const contents = webContents.fromId(input.webContentsId);

    const ours =
      surface !== undefined &&
      contents !== undefined &&
      !contents.isDestroyed() &&
      contents.getType() === "webview" &&
      contents.hostWebContents?.id === window &&
      contents.session === surface.guestSession.session &&
      surface.host?.id === window &&
      surface.generation === input.generation;

    if (ours && surface.guest === contents) return;

    const free =
      ours &&
      (surface.guest === undefined || surface.guest.isDestroyed()) &&
      !this.#byWebContents.has(contents.id);

    if (!free)
      throw new ExpectedHostError({
        code: "invalid",
        message: "This page can't attach to that browser tab.",
      });
    this.#bind(surface, contents);
  }

  setShown(message: BrowserShownMessage, window: HostWindow): void {
    const surface = this.#surfaces.get(message.surface);

    if (surface === undefined) return;
    const shown = reportVisibility(surface, window, message.visible);

    if (shown === "ignored") return;

    if (shown === "moved" || !message.visible) enterBoard(surface, false);

    if (shown !== "moved") return;
    this.place(surface);
    this.publish(surface);
  }

  setEntered(input: Parameters<BrowserBridge["setEntered"]>[0], window: HostWindow): void {
    const surface = this.#surfaces.get(input.surface);

    if (surface === undefined || surface.home !== window) return;
    enterBoard(surface, input.entered && surface.visible);
  }

  hostGuests(window: BrowserWindow): void {
    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
      const partition = params.partition;

      if (
        params.src !== "about:blank" ||
        partition === undefined ||
        !this.#guests.hosts(partition)
      ) {
        event.preventDefault();

        return;
      }

      const forced = {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: false,
        plugins: false,
        spellcheck: false,
        zoomFactor: 1,
        focusOnNavigation: false,
        disableHtmlFullscreenWindowResize: true,
      } satisfies WebPreferences;

      pinPreferences(webPreferences, forced);
    });
    window.webContents.on("did-attach-webview", (_event, contents) => {
      guardGuest(contents);
      setTimeout(() => this.#closeUnbound(contents, window), UNBOUND_GUEST_MS);
    });
    window.webContents.ipc.on(WINDOW_ZOOM_CHANNEL, () => {
      for (const surface of this.#surfaces.values()) {
        const contents = surface.guest;

        if (surface.host?.window === window && contents !== undefined && !contents.isDestroyed())
          contents.setZoomFactor(surface.zoom);
      }
    });
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

    for (const surface of this.#surfaces.values()) {
      const contents = surface.guest;
      const host = surface.host;

      if (contents === undefined || contents.isDestroyed() || host === undefined) continue;

      if (focusedContents !== null && contents.devToolsWebContents === focusedContents)
        return surface.id;

      const hosted = window === undefined ? host.window.isFocused() : host.id === window;

      if (hosted && contents.focusedFrame !== null) return surface.id;
    }

    return window === undefined ? undefined : this.#chromeFocus.get(window);
  }

  settingsChanged(): void {
    for (const surface of this.#surfaces.values()) this.publish(surface);
  }

  releaseWindow(window: HostWindow): void {
    this.#chromeFocus.delete(window);
    this.#announced.delete(window);

    for (const surface of this.#surfaces.values()) {
      if (surface.host?.id === window) {
        this.#unbind(surface);
        surface.host = undefined;
      }

      if (surface.home === window) enterBoard(surface, false);

      if (leaveWindow(surface, window) === "unheld") this.#destroy(surface);
    }

    for (const surface of this.#surfaces.values()) {
      if (surface.host === undefined) this.#rehost(surface, window);
    }

    this.reclaimIdle();
    this.#announce();
  }

  #closeUnbound(contents: WebContents, window: BrowserWindow): void {
    if (contents.isDestroyed() || this.#byWebContents.has(contents.id)) return;
    contents.close();

    if (window.isDestroyed()) return;
    const id = window.webContents.id;

    for (const surface of this.#surfaces.values()) {
      if (surface.host?.id === id && surface.guest === undefined) surface.generation += 1;
    }

    this.#announce();
  }

  #released(surface: Surface, held: ReturnType<typeof dropHolder>): void {
    if (held === "absent") return;

    if (held === "unheld") {
      this.#destroy(surface);

      return;
    }

    this.place(surface);
    this.reclaimIdle();
  }

  #create(id: string, owner: BrowserOwner): Surface {
    const surface: Surface = {
      id,
      holders: new Map(),
      runtime: createSurfaceRuntime(),
      guestSession: this.#guests.forOwner(owner),
      guest: undefined,
      waiting: new Set(),
      generation: 0,
      address: undefined,
      zoom: 1,
      visible: false,
      home: undefined,
      host: undefined,
      destroyed: false,
      operations: 0,
      captures: 0,
      lastUse: ++this.#useClock,
      blocked: 0,
      error: undefined,
      owner,
      fullscreen: false,
      windowWasWindowed: false,
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
      design: NO_DESIGN,
      entered: false,
      published: undefined,
    };

    this.#surfaces.set(id, surface);

    return surface;
  }

  #bind(surface: Surface, contents: WebContents): void {
    surface.guest = contents;
    this.#byWebContents.set(contents.id, surface);
    wireSurface(this, surface, contents);
    contents.once("destroyed", () => {
      if (surface.guest !== contents) return;
      this.#unbind(surface);

      if (surface.destroyed || surface.host === undefined) return;
      surface.generation += 1;
      this.#announce();
    });
    contents.setBackgroundThrottling(surface.operations === 0);

    if (surface.zoom !== 1) contents.setZoomFactor(surface.zoom);
    const address = surface.address;
    const started = address === undefined ? Promise.resolve() : this.#navigate(surface, address);

    void started.then(() => {
      if (surface.guest !== contents) return;

      for (const settle of surface.waiting) settle(contents);
      this.publish(surface);
    });
  }

  #unbind(surface: Surface): void {
    const contents = surface.guest;

    if (contents === undefined) return;
    surface.guest = undefined;

    for (const [id, bound] of this.#byWebContents) {
      if (bound !== surface) continue;
      this.#byWebContents.delete(id);
      surface.guestSession.upgrades.delete(id);
    }

    surface.find?.resolve({ active: 0, total: 0 });
    surface.find = undefined;
    surface.login?.();
    surface.login = undefined;
    surface.paused = false;

    if (surface.popup !== undefined && !surface.popup.isDestroyed()) surface.popup.close();
    surface.popup = undefined;
    const window = surface.host?.window;

    if (surface.windowWasWindowed && window !== undefined && !window.isDestroyed())
      window.setFullScreen(false);
    surface.fullscreen = false;
    surface.windowWasWindowed = false;

    if (!contents.isDestroyed()) contents.close();
    this.publish(surface);
  }

  #announce(): void {
    const lists = new Map<HostWindow, BrowserGuest[]>(
      [...this.#announced.keys()].map((window) => [window, []]),
    );

    for (const surface of this.#surfaces.values()) {
      const host = surface.host;

      if (host === undefined) continue;
      lists.set(host.id, [...(lists.get(host.id) ?? []), surfaceGuest(surface)]);
    }

    for (const [window, guests] of lists) {
      const announced = this.#announced.get(window);

      if (announced !== undefined && Value.Equal(announced, guests)) continue;
      this.#announced.set(window, guests);
      this.dependencies.emit({ kind: "browser_guests", guests }, window);
    }
  }

  #destroy(surface: Surface): void {
    if (surface.destroyed) return;
    surface.destroyed = true;
    this.#surfaces.delete(surface.id);

    for (const [window, id] of this.#chromeFocus) {
      if (id === surface.id) this.#chromeFocus.delete(window);
    }

    for (const settle of surface.waiting) settle(undefined);
    this.#unbind(surface);
    surface.host = undefined;
    this.#announce();
  }
}
