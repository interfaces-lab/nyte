import { app, Notification } from "electron";
import type { HostEvent, TerminalNotice } from "@nyte-ai/app/contract/bridge.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { SessionId } from "@nyte-ai/sdk";
import { findViewer, stepWindowAttention } from "../shared/attention.ts";
import type {
  AttentionDelivery,
  AttentionWindows,
  WindowAttentionEvent,
} from "../shared/attention.ts";
import type { HostWindow } from "../shared/host-window.ts";

export interface AlertWindows {
  focused(): HostWindow | undefined;
  latest(): HostWindow;
  reveal(window: HostWindow): void;
  send(window: HostWindow, event: HostEvent): void;
}

const KEPT_NOTIFICATIONS = 100;

export class Alerts {
  readonly #settings: () => DesktopSettings;
  readonly #windows: AlertWindows;
  #windowStates: AttentionWindows = new Map();
  readonly #kept = new Set<Notification>();
  #bounce: number | undefined;

  constructor(settings: () => DesktopSettings, windows: AlertWindows) {
    this.#settings = settings;
    this.#windows = windows;
    app.on("browser-window-focus", () => this.#stopBounce());
  }

  /** Alerts only reach someone who is away: while any Nyte window is focused, the sidebar already shows it. */
  agent(delivery: AttentionDelivery): void {
    if (this.#windows.focused() !== undefined) return;

    if (delivery.notify)
      this.#post({ title: delivery.title, body: delivery.body, silent: !delivery.sound }, () =>
        this.#openChat(delivery.session),
      );

    if (!delivery.bounce || app.dock === undefined) return;
    this.#stopBounce();
    this.#bounce = app.dock.bounce("critical");
  }

  badge(count: number): void {
    app.dock?.setBadge(count === 0 ? "" : String(count));
  }

  viewing(window: HostWindow, viewed: string | null): void {
    this.#step({ kind: "viewing", window, viewed });
  }

  terminal(window: HostWindow, notice: TerminalNotice): void {
    const settings = this.#settings();

    if (
      !settings.notifications ||
      !settings.terminalNotifications ||
      this.#windows.focused() !== undefined
    )
      return;
    this.#post({ ...notice, silent: !settings.notificationSounds }, () =>
      this.#windows.reveal(window),
    );
  }

  reloading(window: HostWindow): void {
    this.#step({ kind: "reloading", window });
  }

  release(window: HostWindow): void {
    this.#step({ kind: "released", window });
  }

  /** `latest()` runs only when no window views the chat, because it restores windows when none is open. */
  #openChat(session: SessionId): void {
    this.#step({
      kind: "clicked",
      window: findViewer(this.#windowStates, session) ?? this.#windows.latest(),
      session,
    });
  }

  #step(event: WindowAttentionEvent): void {
    const step = stepWindowAttention(this.#windowStates, event);
    this.#windowStates = step.windows;

    if (step.reveal !== undefined) this.#windows.reveal(step.reveal);

    if (step.open !== undefined)
      this.#windows.send(step.open.window, { kind: "open_session", session: step.open.session });
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
