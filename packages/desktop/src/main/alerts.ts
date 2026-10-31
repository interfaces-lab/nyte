import { app, Notification } from "electron";
import type { HostEvent, TerminalNotice } from "@nyte-ai/app/contract/bridge.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { SessionId } from "@nyte-ai/sdk";
import type { AttentionDelivery } from "../shared/attention.ts";
import type { HostWindow } from "../shared/host-window.ts";

export interface AlertWindows {
  /** The Nyte window with focus, if Nyte is the active app. */
  focused(): HostWindow | undefined;
  /** The window focused last, opening the saved windows when none is open. */
  latest(): HostWindow;
  reveal(window: HostWindow): void;
  send(window: HostWindow, event: HostEvent): void;
}

/** A window that has reported the chat it shows, or one still loading with a chat to open once it can. */
type WindowState =
  /** The chat on screen as the window reported it; compared with sessions, never trusted as one. */
  | { readonly kind: "ready"; readonly viewed: string | null }
  | { readonly kind: "loading"; readonly opening: SessionId };

/** macOS keeps a notification clickable in Notification Center only while it stays referenced. */
const KEPT_NOTIFICATIONS = 100;

/**
 * Posts what the host decided deserves your attention: system notifications that open their
 * chat when clicked, the Dock badge, and a Dock bounce that stops once you switch to Nyte.
 * Knows which chat each window shows, so it can stay quiet about the one you're looking at.
 */
export class Alerts {
  readonly #settings: () => DesktopSettings;
  readonly #windows: AlertWindows;
  readonly #windowStates = new Map<HostWindow, WindowState>();
  readonly #kept = new Set<Notification>();
  #bounce: number | undefined;

  constructor(settings: () => DesktopSettings, windows: AlertWindows) {
    this.#settings = settings;
    this.#windows = windows;
    app.on("browser-window-focus", () => this.#stopBounce());
  }

  agent(delivery: AttentionDelivery): void {
    const focused = this.#windows.focused();

    if (
      focused !== undefined &&
      this.#viewed(focused) === delivery.session &&
      !this.#settings().notifyViewedChat
    )
      return;

    if (delivery.notify)
      this.#post({ title: delivery.title, body: delivery.body, silent: !delivery.sound }, () =>
        this.#openChat(delivery.session),
      );

    if (!delivery.bounce || focused !== undefined || app.dock === undefined) return;
    this.#stopBounce();
    this.#bounce = app.dock.bounce("critical");
  }

  badge(count: number): void {
    app.dock?.setBadge(count === 0 ? "" : String(count));
  }

  viewing(window: HostWindow, viewed: string | null): void {
    const before = this.#windowStates.get(window);

    this.#windowStates.set(window, {
      kind: "ready",
      viewed,
    });

    if (before?.kind === "loading")
      this.#windows.send(window, { kind: "open_session", session: before.opening });
  }

  /** Terminal notifications are system notifications too, so the page-wide switch silences them. */
  terminal(window: HostWindow, notice: TerminalNotice): void {
    const settings = this.#settings();

    if (!settings.notifications || !settings.terminalNotifications) return;
    this.#post({ ...notice, silent: !settings.notificationSounds }, () =>
      this.#windows.reveal(window),
    );
  }

  /** The window's page loads again; it reports its chat once it's ready, and a chat waiting to open stays. */
  reloading(window: HostWindow): void {
    if (this.#windowStates.get(window)?.kind === "ready") this.#windowStates.delete(window);
  }

  release(window: HostWindow): void {
    this.#windowStates.delete(window);
  }

  #viewed(window: HostWindow): string | null | undefined {
    const state = this.#windowStates.get(window);

    return state?.kind === "ready" ? state.viewed : undefined;
  }

  #openChat(session: SessionId): void {
    const target =
      [...this.#windowStates.keys()].find((window) => this.#viewed(window) === session) ??
      this.#windows.latest();

    this.#windows.reveal(target);

    if (this.#windowStates.get(target)?.kind === "ready")
      this.#windows.send(target, { kind: "open_session", session });
    else this.#windowStates.set(target, { kind: "loading", opening: session });
  }

  #post(options: Electron.NotificationConstructorOptions, click: () => void): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification(options);
    const forget = (): void => void this.#kept.delete(notification);

    notification.on("click", () => {
      forget();
      click();
    });
    notification.on("close", forget);
    this.#kept.add(notification);

    for (const old of this.#kept) {
      if (this.#kept.size <= KEPT_NOTIFICATIONS) break;
      this.#kept.delete(old);
    }

    notification.show();
  }

  #stopBounce(): void {
    if (this.#bounce === undefined) return;
    app.dock?.cancelBounce(this.#bounce);
    this.#bounce = undefined;
  }
}
