import { basename } from "node:path";
import type { AppDetailsOptions } from "electron";
import type { DesktopApp } from "@nyte-ai/app/contract/desktop-app.ts";
import type { ArrivalSubject, DesktopWindowOpen } from "@nyte-ai/app/contract/desktop-window.ts";
import type { HostWindow } from "../shared/host-window.ts";
import type { CallInput } from "../shared/ipc.ts";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const APP_NAMES = {
  nyte: "Nyte",
  code: "Nyte Code",
  studio: "Nyte Studio",
} as const satisfies Record<DesktopApp, string>;

/** "Nyte Code — tide": the app, and the project when the window has one. */
export function windowTitle(app: DesktopApp, workspacePath: string | undefined): string {
  return workspacePath === undefined
    ? APP_NAMES[app]
    : `${APP_NAMES[app]} — ${basename(workspacePath)}`;
}

/**
 * Where a new app window goes: in the room to the right of the window that opened it, else to its left, at most as
 * wide as that window and as tall, so two windows tile the display; with no room on either side, centred on it.
 */
export function besideBounds(current: Rect, workArea: Rect, minWidth: number): Rect {
  const y = Math.max(current.y, workArea.y);
  const height = Math.min(current.height, workArea.y + workArea.height - y);
  const right = workArea.x + workArea.width - (current.x + current.width);
  const left = current.x - workArea.x;

  if (right >= minWidth)
    return { x: current.x + current.width, y, width: Math.min(current.width, right), height };

  if (left >= minWidth) {
    const width = Math.min(current.width, left);

    return { x: current.x - width, y, width, height };
  }

  const width = Math.min(current.width, workArea.width);
  const tall = Math.min(current.height, workArea.height);

  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - tall) / 2),
    width,
    height: tall,
  };
}

interface SwitchPorts<Window> {
  /** Every window, in the order they were last focused, latest last. */
  readonly windows: () => Iterable<readonly [HostWindow, Window]>;
  readonly workspace: (window: HostWindow) => string | undefined;
  readonly arrive: (window: Window, subject: ArrivalSubject | undefined) => void;
  readonly open: (app: DesktopApp, opening: DesktopWindowOpen, beside: Window) => void;
}

type SwitchInput = CallInput<"host.switchApp">;

/**
 * Switches from a window to an app on the same project: focuses that app's window there and lands it on the subject,
 * or opens one. A flip goes to the other app last focused on the project; with none yet, Nyte flips to Code and the
 * others flip to Nyte.
 */
export function createAppSwitch<Window extends { readonly app: DesktopApp }>(
  ports: SwitchPorts<Window>,
): (caller: HostWindow, input: SwitchInput) => void {
  return (caller, input) => {
    const path = input.workspace?.path;
    const all = [...ports.windows()];
    const from = all.find((pair) => pair[0] === caller)?.[1];

    const onProject = all
      .flatMap((pair) => (ports.workspace(pair[0]) === path ? [pair[1]] : []))
      .toReversed();

    if (from === undefined) return;

    const app =
      input.to === "last"
        ? (onProject.find((window) => window.app !== from.app)?.app ??
          (from.app === "nyte" ? "code" : "nyte"))
        : input.to;

    if (app === from.app) return;
    const subject = input.subject ?? undefined;
    const found = onProject.find((window) => window.app === app);

    if (found !== undefined) {
      ports.arrive(found, subject);

      return;
    }

    ports.open(app, { kind: "app", workspace: input.workspace ?? undefined, subject }, from);
  };
}

/**
 * The Windows taskbar identity of an app's windows. Each app has its own AppUserModelID, so the taskbar groups its
 * windows apart from the others'; Nyte keeps the installer's, so its windows group with the pinned shortcut.
 */
export function windowsAppDetails(
  app: DesktopApp,
  appId: string,
  executable: string,
): AppDetailsOptions {
  return {
    appId: app === "nyte" ? appId : `${appId}.${app}`,
    appIconPath: executable,
    appIconIndex: 0,
  };
}
