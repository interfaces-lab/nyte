import { readFile, readdir } from "node:fs/promises";
import React from "react";
import jsxRuntime from "react/jsx-runtime";
import { compileCanvas } from "@nyte-ai/plugin/canvas";
import { JSX_RUNTIME_EXPORTS, KIT_EXPORTS, REACT_EXPORTS } from "@nyte-ai/plugin/canvas-protocol";
import { expect, it } from "vitest";
import { kit } from "../src/kit/index.ts";

it("exports exactly the names the plugin advertises, in order", () => {
  expect(Object.keys(kit)).toEqual(KIT_EXPORTS);

  for (const name of KIT_EXPORTS)
    expect(Object.getOwnPropertyDescriptor(kit, name)?.value, name).toBeDefined();
});

it("backs every react and jsx-runtime name the compiler lets a canvas import", () => {
  for (const name of REACT_EXPORTS) expect(name in React, name).toBe(true);

  for (const name of JSX_RUNTIME_EXPORTS) expect(name in jsxRuntime, name).toBe(true);
});

it("compiles every fixture", async () => {
  const compile = compileCanvas;
  const fixtures = (await readdir(new URL("./fixtures/", import.meta.url))).filter((name) =>
    name.endsWith(".tsx"),
  );

  expect(fixtures.length).toBeGreaterThanOrEqual(3);

  for (const name of fixtures) {
    const outcome = await compile(
      await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    );

    expect(outcome.kind, `${name}: ${JSON.stringify(outcome)}`).toBe("compiled");
  }
});
