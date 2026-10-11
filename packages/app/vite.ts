import { cp, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
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

/** The built runtime shell, `pnpm --dir packages/canvas build`. */
const SHELL_DIRECTORY = fileURLToPath(new URL("../canvas/dist/shell/", import.meta.url));

const SHELL_MISSING =
  "packages/canvas/dist/shell is missing. Run `pnpm --dir packages/canvas build` first.";

/** The header every shell response carries; `public/vercel.json` repeats it for the deployed site. */
const SHELL_POLICY =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const SHELL_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".map", "application/json"],
]);

/**
 * The canvas shell at `/canvas/`: served from the canvas package's build in
 * development, copied into `dist/canvas/` on build. The iframe loads it with
 * `sandbox="allow-scripts"`, so it runs in an opaque origin either way.
 */
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
