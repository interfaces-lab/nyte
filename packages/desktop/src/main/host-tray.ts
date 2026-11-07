import { join } from "node:path";
import process from "node:process";
import { dev } from "@nyte-ai/sdk/client";
import { app, clipboard, Menu, nativeImage, shell, Tray } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";
import { processAlive } from "./host-agent.ts";
import type { HostAgent } from "./host-agent.ts";
import type { HostLink } from "./host-link.ts";
import { readHostStatus } from "./host-status.ts";
import type { LaunchStateStore } from "./launch-state.ts";
import type { HostIssue, HostReading, HostStatus } from "./host-status.ts";

const PROBE_EVERY_MS = 5_000;

const STATUS_LABELS = {
  running: "Running",
  issues: "Running with Issues",
  stopped: "Stopped",
} as const satisfies { readonly [S in HostStatus]: string };

const STATUS_COLORS = {
  running: [52, 199, 89],
  issues: [255, 159, 10],
  stopped: [255, 59, 48],
} as const satisfies { readonly [S in HostStatus]: readonly [number, number, number] };

const MAC_VERSION = process.getSystemVersion().split(".").map(Number);

/** Menu item sublabels draw from macOS 14.4; before it, the status joins the label. */
const SUBLABELS =
  (MAC_VERSION[0] ?? 0) > 14 || ((MAC_VERSION[0] ?? 0) === 14 && (MAC_VERSION[1] ?? 0) >= 4);

const ISSUE_LABELS = {
  approval: "Approve Nyte Host in System Settings > Login Items",
  unreachable: "Nyte can't connect to the host",
} as const satisfies { readonly [I in HostIssue]: string };

export interface HostTrayOptions {
  readonly agent: HostAgent;
  readonly link: HostLink;
  readonly launchState: Pick<LaunchStateStore, "menuBarOnly" | "setMenuBarOnly">;
  checkForUpdates(): void;
  openApp(): void;
  openSettings(): void;
}

export interface HostTray {
  refresh(): void;
}

export function createHostTray(options: HostTrayOptions): HostTray {
  if (options.launchState.menuBarOnly()) app.dock?.hide();
  const icon = nativeImage.createFromPath(trayIconPath());
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const dots = new Map<HostStatus, NativeImage>();
  let reading: HostReading = { status: "stopped", issues: [] };
  let open = false;
  let probing: Promise<void> | undefined;

  const refresh = (): Promise<void> => {
    probing ??= probe(options).then(
      (next) => {
        probing = undefined;
        reading = next.reading;
        tray.setToolTip(`Nyte Host: ${STATUS_LABELS[reading.status]}`);
        dev("host-status", reading.status, { pid: next.pid, issues: reading.issues });
      },
      () => {
        probing = undefined;
      },
    );

    return probing;
  };

  const dot = (status: HostStatus): NativeImage => {
    const found = dots.get(status);

    if (found !== undefined) return found;
    const made = statusDot(STATUS_COLORS[status]);
    dots.set(status, made);

    return made;
  };

  const show = async (): Promise<void> => {
    await refresh();
    const menu = Menu.buildFromTemplate(items(options, reading, dot(reading.status)));
    menu.once("menu-will-show", () => {
      open = true;
    });
    menu.once("menu-will-close", () => {
      open = false;
    });
    tray.popUpContextMenu(menu);
  };

  tray.on("click", () => void show());
  tray.on("right-click", () => void show());

  const timer = setInterval(() => {
    if (!open) void refresh();
  }, PROBE_EVERY_MS);

  app.once("will-quit", () => {
    clearInterval(timer);
    tray.destroy();
  });
  void refresh();

  return { refresh: () => void refresh() };
}

async function probe(
  options: HostTrayOptions,
): Promise<{ readonly reading: HostReading; readonly pid: number | null }> {
  const [pid, registration] = await Promise.all([
    options.agent.pid(),
    options.agent.registration(),
  ]);

  const reading = readHostStatus({
    pid,
    alive: pid !== null && processAlive(pid),
    registration,
    link: options.link.state.kind,
  });

  return { reading, pid };
}

function items(
  options: HostTrayOptions,
  reading: HostReading,
  dot: NativeImage,
): MenuItemConstructorOptions[] {
  const state = options.link.state;
  const host = state.kind === "connected" ? state.version : "unknown";
  const versions = `Nyte ${app.getVersion()} · Host ${host}`;

  return [
    {
      label: SUBLABELS ? "Nyte Host" : `Nyte Host: ${STATUS_LABELS[reading.status]}`,
      sublabel: SUBLABELS ? STATUS_LABELS[reading.status] : undefined,
      icon: dot,
      click: () => options.openApp(),
    },
    ...reading.issues.map((issue): MenuItemConstructorOptions =>
      issue === "approval"
        ? {
            label: ISSUE_LABELS.approval,
            click: () =>
              void shell.openExternal(
                "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
              ),
          }
        : { label: ISSUE_LABELS.unreachable, enabled: false },
    ),
    { type: "separator" },
    {
      label: SUBLABELS ? "Copy Versions" : `Copy ${versions}`,
      sublabel: SUBLABELS ? versions : undefined,
      click: () => clipboard.writeText(versions),
    },
    { type: "separator" },
    { label: "Check for Updates…", click: () => options.checkForUpdates() },
    { label: "Settings…", click: () => options.openSettings() },
    {
      label: "Menu bar only",
      type: "checkbox",
      checked: options.launchState.menuBarOnly(),
      click: (item) => setMenuBarOnly(options, item.checked),
    },
    { type: "separator" },
    { label: "Quit Nyte", click: () => app.quit() },
  ];
}

function statusDot(color: readonly [number, number, number]): NativeImage {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const alpha = Math.max(0, Math.min(1, 5.5 - distance));
      const at = (y * size + x) * 4;
      pixels[at] = Math.round(color[2] * alpha);
      pixels[at + 1] = Math.round(color[1] * alpha);
      pixels[at + 2] = Math.round(color[0] * alpha);
      pixels[at + 3] = Math.round(255 * alpha);
    }

  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
}

function setMenuBarOnly(options: HostTrayOptions, menuBarOnly: boolean): void {
  options.launchState.setMenuBarOnly(menuBarOnly);

  if (menuBarOnly) app.dock?.hide();
  else void app.dock?.show();
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "trayTemplate.png")
    : join(app.getAppPath(), "resources", "trayTemplate.png");
}
