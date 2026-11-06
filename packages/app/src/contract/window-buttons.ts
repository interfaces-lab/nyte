export function macOSWindowButtonHeight(darwinRelease: string): number {
  return Number.parseFloat(darwinRelease) >= 25 ? 14 : 16;
}
