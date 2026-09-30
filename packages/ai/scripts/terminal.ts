import { styleText } from "node:util";

export function seconds(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
}

export function done(label: string, detail: string, width = 0): void {
  console.log(`${styleText("green", "✓")} ${label.padEnd(width)}  ${styleText("dim", detail)}`);
}

export function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`${styleText("red", "✗")} ${message}`);
  process.exitCode = 1;
}
