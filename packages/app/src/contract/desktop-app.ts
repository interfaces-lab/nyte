/** Nyte's three apps, which are window kinds of one desktop app: chat and terminal, the editor, and the design board. */
export const DESKTOP_APPS = ["nyte", "code", "studio"] as const;

export type DesktopApp = (typeof DESKTOP_APPS)[number];

/** Reads the app the main process named for a window. The preload imports this module alone, so it imports nothing. */
export function parseDesktopApp(argument: string | undefined): DesktopApp {
  const app = DESKTOP_APPS.find((candidate) => candidate === argument);

  if (app === undefined) {
    throw new Error("The main process names the app of every window it opens.");
  }

  return app;
}
