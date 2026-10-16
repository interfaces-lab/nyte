import { cp, readFile, stat } from "node:fs/promises";
import { createWriteStream, mkdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevRow } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin } from "vite";

export { stylex } from "@nyte-ai/ui/stylex";

export function dropInlinedGhosttyWasm(): Plugin {
  const inlinedWasm = /"data:application\/wasm;base64,[A-Za-z0-9+/=]+"/u;

  return {
    name: "nyte:drop-inlined-ghostty-wasm",
    apply: "build",
    transform: {
      filter: { id: /\/ghostty-web\/dist\/ghostty-web\.js(?:\?|$)/u },
      handler(code) {
        if (!inlinedWasm.test(code)) {
          this.error("ghostty-web no longer inlines its wasm; remove dropInlinedGhosttyWasm");
        }

        return { code: code.replace(inlinedWasm, '""'), map: null };
      },
    },
  };
}

const KATEX = "\0nyte:katex";

/**
 * Streamdown imports katex only for its `latexGuard` option, which Nyte never
 * sets, so the import resolves to a module that refuses to render. Any other
 * importer fails the build: math rendering would need the real package.
 */
export function withoutKatex(): Plugin {
  return {
    name: "nyte:without-katex",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "katex") return;

      if (importer?.includes("/node_modules/@lobehub/streamdown/") !== true) {
        this.error(`katex is stubbed out for Streamdown; ${importer ?? "an entry"} imports it`);
      }

      return KATEX;
    },
    load(id) {
      if (id !== KATEX) return;

      return 'export function renderToString() { throw new Error("Nyte renders no LaTeX"); }';
    },
  };
}

const SHELL_DIRECTORY = fileURLToPath(new URL("../canvas/dist/shell/", import.meta.url));

const SHELL_MISSING =
  "packages/canvas/dist/shell is missing. Run `pnpm --dir packages/canvas build` first.";

const SHELL_POLICY =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const SHELL_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".map", "application/json"],
]);

export function canvasShell(): Plugin {
  let outDir = "dist";

  return {
    name: "nyte:canvas-shell",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/canvas", (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "/";
        const target = resolve(SHELL_DIRECTORY, `.${normalize(pathname)}`);

        if (!target.startsWith(SHELL_DIRECTORY) || target.endsWith(sep)) {
          next();

          return;
        }

        const type = SHELL_TYPES.get(extname(target));

        if (type === undefined) {
          next();

          return;
        }

        void readFile(target).then(
          (body) => {
            response.setHeader("Content-Type", type);
            // The sandboxed frame's origin is opaque, so its module script,
            // stylesheet and fonts are CORS requests.
            response.setHeader("Access-Control-Allow-Origin", "*");

            if (type.startsWith("text/html")) {
              response.setHeader("Content-Security-Policy", SHELL_POLICY);
            }

            response.end(body);
          },
          () => {
            response.statusCode = 404;
            response.end(pathname === "/index.html" ? SHELL_MISSING : "");
          },
        );
      });
    },
    async writeBundle() {
      try {
        await stat(join(SHELL_DIRECTORY, "index.html"));
      } catch {
        this.error(SHELL_MISSING);
      }

      await cp(SHELL_DIRECTORY, join(outDir, "canvas"), { recursive: true });
    },
  };
}

const CONSOLE_ROWS = 20_000;

const CONSOLE_PAGE = fileURLToPath(new URL("./dev-console.html", import.meta.url));

const ROW = Type.Object({
  ts: Type.Number(),
  source: Type.String(),
  area: Type.String(),
  message: Type.String(),
  data: Type.String(),
});

function rowsOf(body: string): readonly DevRow[] {
  try {
    return Value.Parse(Type.Array(Type.Unknown()), JSON.parse(body)).filter((item) =>
      Value.Check(ROW, item),
    );
  } catch {
    return [];
  }
}

export function devConsole(): Plugin {
  return {
    name: "nyte:dev-console",
    apply: "serve",
    configureServer(server) {
      const rows: DevRow[] = [];
      const watchers = new Set<ServerResponse>();
      const directory = resolve(server.config.root, ".nyte");
      mkdirSync(directory, { recursive: true });
      const file = createWriteStream(join(directory, "dev-log.jsonl"), { flags: "w" });
      let seq = 0;

      const accept = (batch: readonly DevRow[]): void => {
        for (const row of batch) {
          seq += 1;
          const kept = { seq, ...row };
          rows.push(kept);
          file.write(`${JSON.stringify(kept)}\n`);
          const chunk = `data: ${JSON.stringify(kept)}\n\n`;

          for (const watcher of watchers) watcher.write(chunk);
        }

        if (rows.length > CONSOLE_ROWS) rows.splice(0, rows.length - CONSOLE_ROWS);
      };

      server.middlewares.use("/__dev", (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "/";

        if (pathname === "/log" && request.method === "POST") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            accept(rowsOf(Buffer.concat(chunks).toString("utf8")));
            response.statusCode = 204;
            response.end();
          });

          return;
        }

        if (pathname === "/rows") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(rows));

          return;
        }

        if (pathname === "/clear" && request.method === "POST") {
          rows.length = 0;
          response.statusCode = 204;
          response.end();

          return;
        }

        if (pathname === "/stream") {
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          response.write(":ok\n\n");
          watchers.add(response);
          request.on("close", () => watchers.delete(response));

          return;
        }

        if (pathname === "/" || pathname === "") {
          void readFile(CONSOLE_PAGE).then(
            (body) => {
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.end(body);
            },
            () => next(),
          );

          return;
        }

        next();
      });
    },
  };
}
