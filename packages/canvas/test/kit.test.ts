import { readFile, readdir } from "node:fs/promises";
import React from "react";
import ReactDom from "react-dom";
import jsxRuntime from "react/jsx-runtime";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import {
  CANVAS_ENTRY,
  JSX_RUNTIME_EXPORTS,
  KIT_EXPORTS,
  LIBRARY_EXPORTS,
  LIBRARY_VERSIONS,
  REACT_DOM_EXPORTS,
  REACT_EXPORTS,
} from "@nyte-ai/plugin/canvas/protocol";
import { expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { kit } from "../src/kit/index.ts";

const fixtures = new URL("./fixtures/", import.meta.url);

/** Every fixture as the tool takes it: a `.tsx` file alone, or a folder's main.tsx with its other files. */
async function readFixtures() {
  const entries = await readdir(fixtures, { withFileTypes: true });

  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.name.endsWith(".tsx"))
      .map(async (entry) => {
        if (!entry.isDirectory())
          return {
            name: entry.name,
            source: await readFile(new URL(entry.name, fixtures), "utf8"),
            files: {},
          };
        const folder = new URL(`${entry.name}/`, fixtures);
        const names = (await readdir(folder)).filter((name) => /\.tsx?$/u.test(name));
        const read = (name: string) => readFile(new URL(name, folder), "utf8");

        return {
          name: entry.name,
          source: await read(CANVAS_ENTRY),
          files: Object.fromEntries(
            await Promise.all(
              names
                .filter((name) => name !== CANVAS_ENTRY)
                .map(async (name) => [name, await read(name)] as const),
            ),
          ),
        };
      }),
  );
}

it("exports exactly the names the plugin advertises, in order", () => {
  expect(Object.keys(kit)).toEqual(KIT_EXPORTS);

  for (const name of KIT_EXPORTS)
    expect(Object.getOwnPropertyDescriptor(kit, name)?.value, name).toBeDefined();
});

it("backs every react, react-dom and jsx-runtime name the compiler lets a canvas import", () => {
  for (const name of REACT_EXPORTS) expect(name in React, name).toBe(true);

  for (const name of REACT_DOM_EXPORTS) expect(name in ReactDom, name).toBe(true);

  for (const name of JSX_RUNTIME_EXPORTS) expect(name in jsxRuntime, name).toBe(true);
});

it("lists each library's real exports at the version this package pins", async () => {
  const pinned: Readonly<Record<string, string>> = manifest.dependencies;

  for (const [name, names] of Object.entries(LIBRARY_EXPORTS)) {
    const module: object = await import(name);

    expect(Object.keys(module).toSorted(), name).toEqual(names);
    expect(LIBRARY_VERSIONS[name], name).toBe(pinned[name]);
  }
});

it("compiles every fixture, the multi-file ones as one module graph", async () => {
  const found = await readFixtures();

  expect(found.length).toBeGreaterThanOrEqual(3);
  expect(found.some((fixture) => Object.keys(fixture.files).length > 0)).toBe(true);

  for (const fixture of found) {
    const outcome = await compileCanvas(fixture.source, fixture.files);

    expect(outcome.kind, `${fixture.name}: ${JSON.stringify(outcome)}`).toBe("compiled");
  }
});
