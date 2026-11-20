import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../src");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.tsx?$/u.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

const files = sources(root).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("the app's imports", () => {
  it("reach the host only through the sdk and the plugins", () => {
    const forbidden =
      /from "(node:[^"]*|@nyte-ai\/(core|host|protocol|client|server|telemetry)(\/[^"]*)?)"/u;

    expect(files.filter((file) => forbidden.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it("read views and watch them, never folding events or invalidating a cache", () => {
    const folding = /\.events\(|invalidateQueries|refetchInterval|SessionObserver|outbox/u;

    expect(files.filter((file) => folding.test(file.text)).map((file) => file.path)).toEqual([]);
  });
});
