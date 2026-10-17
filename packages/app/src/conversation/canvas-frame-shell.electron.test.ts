import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const canvasPackage = fileURLToPath(new URL("../../../canvas/", import.meta.url));

const shellRoot = join(canvasPackage, "dist", "shell");

const built = await readFile(join(shellRoot, "libraries", "three.js")).then(
  () => true,
  () => false,
);

const SHELL_POLICY =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

const BROKEN = `import { Text } from "nyte/canvas";
import { rows } from "./rows.ts";
export default function Broken() {
  const first = rows[0];
  return <Text>{first.label}</Text>;
}`;

async function compileFolder(folder: string) {
  const names = (await readdir(folder)).filter((name) => /\.tsx?$/u.test(name));
  const read = (name: string) => readFile(join(folder, name), "utf8");
  const files = Object.fromEntries(
    await Promise.all(
      names.filter((name) => name !== "main.tsx").map(async (name) => [name, await read(name)]),
    ),
  );

  return compileCanvas(await read("main.tsx"), files);
}

test.skipIf(!built)(
  "a canvas frame over the built shell draws the multi-file three.js galaxy and reports a runtime error with its file and line",
  { timeout: 90_000 },
  async () => {
    const galaxy = await compileFolder(join(canvasPackage, "test/fixtures/repo-galaxy"));
    const broken = await compileCanvas(BROKEN, {
      "rows.ts": "export const rows: { label: string }[] = [];",
    });

    if (galaxy.kind !== "compiled" || broken.kind !== "compiled")
      throw new Error(JSON.stringify([galaxy, broken]));
    const server = createServer((request, response) => {
      const path = normalize((request.url ?? "/").split("?")[0] ?? "/");
      const file = join(shellRoot, path === "/" ? "index.html" : path);

      readFile(file).then(
        (body) => {
          response.setHeader(
            "Content-Type",
            TYPES.get(extname(file)) ?? "application/octet-stream",
          );
          response.setHeader("Access-Control-Allow-Origin", "*");

          if (file.endsWith(".html")) response.setHeader("Content-Security-Policy", SHELL_POLICY);
          response.end(body);
        },
        () => {
          response.statusCode = 404;
          response.end();
        },
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();

      if (address === null || typeof address === "string") throw new Error("No port.");
      const { port } = address;
      const canvases = {
        galaxy: { runtime: galaxy.runtime, code: galaxy.code },
        broken: { runtime: broken.runtime, code: broken.code },
      };

      expect(
        await testRenderer(
          new URL("./canvas-frame-shell.browser-test.tsx", import.meta.url),
          `window.nyte = { clientSurface: "desktop", canvasShell: "http://127.0.0.1:${String(port)}/index.html", host: { setThemePreference() {} } }; window.canvases = ${JSON.stringify(canvases)};`,
        ),
      ).toBe("passed");
    } finally {
      server.close();
    }
  },
);
