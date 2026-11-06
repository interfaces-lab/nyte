export interface DesktopWindow {
  readonly id: string;
  readonly launch: { readonly windowIds: readonly string[] } | undefined;
}
