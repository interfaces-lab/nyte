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
import type { HostWindow, WindowEnd } from "../shared/host-window.ts";

export interface AlertWindows {
  focused(): HostWindow | undefined;
  latest(): HostWindow;
  reveal(window: HostWindow): void;
  send(window: HostWindow, event: HostEvent): void;
}

const KEPT_NOTIFICATIONS = 100;

export class Alerts {
  private readonly settings: () => DesktopSettings;
  private readonly windows: AlertWindows;
  private windowStates: AttentionWindows = new Map();
  private readonly kept = new Set<Notification>();
  private bounce: number | undefined;

  constructor(settings: () => DesktopSettings, windows: AlertWindows) {
    this.settings = settings;
    this.windows = windows;
    app.on("browser-window-focus", (_event, window) => {
      this.stopBounce();
      this.step({ kind: "focused", window: window.webContents.id });
    });
  }

  agent(delivery: AttentionDelivery): void {
    if (this.windows.focused() !== undefined) return;

    if (delivery.notify) {
      this.post({ title: delivery.title, body: delivery.body, silent: !delivery.sound }, () =>
        this.openChat(delivery.session),
      );
    }

    if (!delivery.bounce || app.dock === undefined) return;
    this.stopBounce();
    this.bounce = app.dock.bounce("critical");
  }

  badge(count: number): void {
    app.dock?.setBadge(count === 0 ? "" : String(count));
  }

  viewing(window: HostWindow, viewed: string | null): void {
    this.step({ kind: "viewing", window, viewed });
  }

  terminal(window: HostWindow, notice: TerminalNotice): void {
    const settings = this.settings();

    if (
      !settings.notifications ||
      !settings.terminalNotifications ||
      this.windows.focused() !== undefined
    ) {
      return;
    }
    this.post({ ...notice, silent: !settings.notificationSounds }, () =>
      this.windows.reveal(window),
    );
  }

  windowEnded(window: HostWindow, end: WindowEnd): void {
    this.step({ kind: "ended", window, end });
  }

  openChat(session: SessionId): void {
    this.step({
      kind: "clicked",
      window: findViewer(this.windowStates, session) ?? this.windows.latest(),
      session,
    });
  }

  private step(event: WindowAttentionEvent): void {
    const step = stepWindowAttention(this.windowStates, event);
    this.windowStates = step.windows;

    if (step.reveal !== undefined) this.windows.reveal(step.reveal);

    if (step.open !== undefined) {
      this.windows.send(step.open.window, { kind: "open_session", session: step.open.session });
    }
  }

  private post(options: Electron.NotificationConstructorOptions, click: () => void): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification(options);
    const forget = (): void => void this.kept.delete(notification);

    notification.on("click", () => {
      forget();
      click();
    });
    notification.on("close", forget);
    this.kept.add(notification);

    for (const old of this.kept) {
      if (this.kept.size <= KEPT_NOTIFICATIONS) break;
      this.kept.delete(old);
    }

    notification.show();
  }

  private stopBounce(): void {
    if (this.bounce === undefined) return;
    app.dock?.cancelBounce(this.bounce);
    this.bounce = undefined;
  }
}
