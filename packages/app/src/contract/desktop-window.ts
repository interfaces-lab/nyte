/** How the desktop opened a window: its lasting id and, when no other window was open, every id worth keeping. */
export interface DesktopWindow {
  readonly id: string;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
}
