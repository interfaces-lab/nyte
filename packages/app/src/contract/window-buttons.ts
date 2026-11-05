/**
 * The height in points of the macOS window buttons, from the product version that
 * `process.getSystemVersion()` returns: 14 from macOS 26, a 16pt frame before. VS Code and Cursor
 * switch at 25 because they read the Darwin kernel release (`os.release()`), and macOS 26 is
 * Darwin 25.
 */
export function macOSWindowButtonHeight(systemVersion: string): number {
  return Number.parseFloat(systemVersion) >= 26 ? 14 : 16;
}
