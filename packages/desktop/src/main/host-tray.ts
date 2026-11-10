import { join } from "node:path";
import process from "node:process";
import { dev } from "@nyte-ai/sdk/client";
import { app, clipboard, Menu, nativeImage, shell, Tray } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";
import { processAlive } from "./host-agent.ts";
import type { HostAgent } from "./host-agent.ts";
import type { HostLink } from "./host-link.ts";
import { readHostStatus } from "./host-status.ts";
import type { HostIssue, HostReading, HostStatus } from "./host-status.ts";

const PROBE_EVERY_MS = 5_000;

const HEADER_ICON_POINTS = 32;

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
  checkForUpdates(): void;
  openApp(): void;
  openSettings(): void;
}

export interface HostTray {
  refresh(): void;
}

export function createHostTray(options: HostTrayOptions): HostTray {
  const icon = nativeImage.createFromPath(resourcePath("trayTemplate.png"));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const appIcon = nativeImage.createFromPath(resourcePath("icon.png"));
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

  const show = async (): Promise<void> => {
    await refresh();

    const menu = Menu.buildFromTemplate(
      items(options, reading, badgedIcon(appIcon, STATUS_COLORS[reading.status])),
    );
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
  headerIcon: NativeImage,
): MenuItemConstructorOptions[] {
  const state = options.link.state;

  const versions = [
    `Nyte ${app.getVersion()}`,
    ...(state.kind === "connected" ? [`Nyte Host ${state.version}`] : []),
  ];

  return [
    {
      label: SUBLABELS ? "Nyte Host" : `Nyte Host: ${STATUS_LABELS[reading.status]}`,
      sublabel: SUBLABELS ? STATUS_LABELS[reading.status] : undefined,
      icon: headerIcon,
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
    ...versions.map((label): MenuItemConstructorOptions => ({
      label,
      toolTip: "Copy Versions",
      click: () => clipboard.writeText(versions.join("\n")),
    })),
    { type: "separator" },
    { label: "Check for Updates…", click: () => options.checkForUpdates() },
    { label: "Settings…", click: () => options.openSettings() },
    { type: "separator" },
    { label: "Quit Nyte", click: () => app.quit() },
  ];
}

function badgedIcon(source: NativeImage, color: readonly [number, number, number]): NativeImage {
  const image = nativeImage.createEmpty();

  for (const scaleFactor of [1, 2]) {
    const size = HEADER_ICON_POINTS * scaleFactor;
    const pixels = source.resize({ width: size, height: size, quality: "best" }).toBitmap();
    const center = size * 0.84;
    const radius = size * 0.11;
    const gap = size * 0.05;

    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
        const keep = 1 - Math.max(0, Math.min(1, radius + gap - distance + 0.5));
        const dot = Math.max(0, Math.min(1, radius - distance + 0.5));
        const at = (y * size + x) * 4;
        pixels[at] = Math.round((pixels[at] ?? 0) * keep + color[2] * dot);
        pixels[at + 1] = Math.round((pixels[at + 1] ?? 0) * keep + color[1] * dot);
        pixels[at + 2] = Math.round((pixels[at + 2] ?? 0) * keep + color[0] * dot);
        pixels[at + 3] = Math.round((pixels[at + 3] ?? 0) * keep + 255 * dot);
      }

    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: pixels });
  }

  return image;
}

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), "resources", name);
}
