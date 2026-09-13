import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, test, vi } from "vitest";
import { Prose } from "./prose.tsx";
import { renderDiagram } from "./mermaid-render.ts";

vi.hoisted(() => {
  vi.stubGlobal("nyte", {});
  vi.stubGlobal("window", globalThis);
});
afterAll(() => vi.unstubAllGlobals());

test("Nyte keeps code controls and image labels while disabling HTML", () => {
  const html = renderToStaticMarkup(
    <Prose
      markdown={
        '```ts\nconst x = "<tag>";\n```\n\n![preview](https://example.com/private.png)\n\n<script>alert(1)</script>'
      }
    />,
  );

  expect(html).toContain("Copy code");
  expect(html).toContain("&lt;tag&gt;");
  expect(html).toContain("preview");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("private.png");
  expect(html).not.toContain("<script");
});

test("Mermaid fences mount a diagram instead of a code block", () => {
  const html = renderToStaticMarkup(<Prose markdown={"```mermaid\ngraph LR\nA --> B\n```"} />);

  expect(html).toContain('aria-label="Mermaid diagram"');
  expect(html).toContain("Rendering diagram…");
  expect(html).toContain("Show source");
  expect(html).not.toContain("<pre");
});

test("the diagram renderer returns SVG and keeps invalid source readable", () => {
  const rendered = renderDiagram("graph LR\nA --> B");
  expect(rendered.kind).toBe("diagram");
  if (rendered.kind === "diagram") expect(rendered.svg).toContain("<svg");
  expect(renderDiagram("not a diagram")).toEqual({ kind: "source" });
});

test("diagram labels cannot inject markup into the transcript", () => {
  const rendered = renderDiagram('graph LR\nA["<script>alert(1)</script>"] --> B');
  expect(rendered.kind).toBe("diagram");
  if (rendered.kind === "diagram") {
    expect(rendered.svg).not.toContain("<script");
    expect(rendered.svg).toContain("&lt;script");
  }
});
