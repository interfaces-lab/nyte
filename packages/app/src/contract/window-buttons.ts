/**
 * The height in points of the macOS window buttons: 14 from macOS 26, a 16pt frame before. It reads
 * the Darwin kernel release, `os.release()`, where macOS 26 is Darwin 25, as VS Code and Cursor do.
 * The product version from `process.getSystemVersion()` isn't safe: an app built against an SDK
 * older than macOS 26 sees macOS 26 reported as 16.0.
 */
export function macOSWindowButtonHeight(darwinRelease: string): number {
  return Number.parseFloat(darwinRelease) >= 25 ? 14 : 16;
}
