import { cp, readFile, readdir, stat } from "node:fs/promises";
import { createWriteStream, mkdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevRow } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { normalizePath, type Plugin } from "vite";

export { stylex } from "@nyte-ai/ui/stylex";

/**
 * Each Central glyph module (`Icon*\/index.mjs`) is bundled standalone and
 * inlines its own copy of the icon base component, about 1.3 KB per glyph.
 * The import resolves every glyph against the package's one `CentralIconBase`
 * module instead, so the base ships once. A glyph module that no longer has
 * the bundled shape fails the build rather than shipping its copy.
 */
export function shareCentralIconBase(): Plugin {
  const inlinedBase =
    /^(import \w+ from"react";)import \w+ from"react";.*?;(\w+)\.displayName="CentralIconBase";.*?;(var \w+=\w+\.memo\()/su;

  return {
    name: "nyte:share-central-icon-base",
    transform: {
      filter: { id: /\/@central-icons-react\/[^/]+\/Icon[^/]+\/index\.mjs(?:\?|$)/u },
      handler(code, id) {
        const match = inlinedBase.exec(code);

        if (match === null) this.error(`${id} no longer inlines CentralIconBase as expected`);

        const [inlined, react, base, glyph] = match;

        return {
          code: `${react}import{CentralIconBase as ${base}}from"../CentralIconBase/index.mjs";${glyph}${code.slice(inlined.length)}`,
          map: null,
        };
      },
    },
  };
}

const STREAMDOWN_CHUNK = /\/node_modules\/streamdown\/dist\/[^/]+\.js(?:\?|$)/u;

const STREAMDOWN_STANDIN = "\0nyte:streamdown/";

const PARSE_ONLY = "?nyte-parse-only";

/** Streamdown's default for each of these tags still renders. Prose's `markdownComponents` overrides every other tag. */
const STREAMDOWN_DEFAULTS = new Set(["thead", "tbody", "tr", "sup", "sub", "section"]);

function unbundled(name: string): string {
  return `throw new Error(${JSON.stringify(`Nyte builds Streamdown without ${name}, which prose replaces. Bundle it again before relying on Streamdown's default.`)})`;
}

const STREAMDOWN_STANDINS = new Map([
  ["rehype-raw", `export default function rehypeRaw(){${unbundled("rehype-raw")}}`],
  [
    "rehype-sanitize",
    `export const defaultSchema={};export default function rehypeSanitize(){${unbundled("rehype-sanitize")}}`,
  ],
  ["rehype-harden", `export function harden(){${unbundled("rehype-harden")}}`],
  ["tailwind-merge", `export const twMerge=(...classes)=>classes.filter(Boolean).join(" ");`],
]);

/** Renders the plain element, so a tag prose stops overriding loses Streamdown's styling instead of the chat. */
const PLAIN_COMPONENT =
  "function nytePlain(tag){return({node,...props})=>createElement(tag,props)}";

/**
 * Streamdown imports what its defaults need, and the bundler can't tell that prose
 * replaces those defaults: its own `rehypePlugins`, so the raw-HTML parser, the
 * sanitizer and the hardener never run, and its own component for every tag but
 * `STREAMDOWN_DEFAULTS`, so the default code block, table controls, link dialog and
 * image download never render. Streamdown also merges its own fixed class lists with
 * tailwind-merge, which has nothing to resolve in them, and registers remark-gfm's
 * markdown serializer, which nothing reads.
 *
 * The build drops all of it. A dropped rehype plugin throws if reached, a dropped
 * component renders the plain element, and a Streamdown or remark-gfm that no longer
 * has the expected shape fails the build.
 */
export function trimStreamdown(): Plugin {
  return {
    name: "nyte:trim-streamdown",
    apply: "build",
    enforce: "pre",
    resolveId: {
      filter: { id: /^(?:rehype-raw|rehype-sanitize|rehype-harden|tailwind-merge|remark-gfm)$/u },
      async handler(source, importer) {
        if (importer === undefined || !STREAMDOWN_CHUNK.test(importer)) return;

        if (source !== "remark-gfm") return `${STREAMDOWN_STANDIN}${source}`;
        const resolved = await this.resolve(source, importer, { skipSelf: true });

        if (resolved === null) this.error("Streamdown no longer resolves remark-gfm");

        return `${join(dirname(resolved.id), "lib", "index.js")}${PARSE_ONLY}`;
      },
    },
    async load(id) {
      if (id.startsWith(STREAMDOWN_STANDIN))
        return STREAMDOWN_STANDINS.get(id.slice(STREAMDOWN_STANDIN.length));

      if (!id.endsWith(PARSE_ONLY)) return;
      const code = await readFile(id.slice(0, -PARSE_ONLY.length), "utf8");

      const parseOnly = code
        .replace("import {gfmFromMarkdown, gfmToMarkdown} from", "import {gfmFromMarkdown} from")
        .replace(/^ *const toMarkdownExtensions =\n.*\n/mu, "")
        .replace(/^ *toMarkdownExtensions\.push\(gfmToMarkdown\(settings\)\)\n/mu, "");

      if (parseOnly.includes("oMarkdown") || !parseOnly.includes("gfmFromMarkdown()"))
        this.error(`${id} no longer registers its markdown serializer as expected`);

      return { code: parseOnly, map: null };
    },
    transform: {
      filter: { id: STREAMDOWN_CHUNK, code: 'displayName="Streamdown"' },
      handler(code, id) {
        const table = /(var [\w$]+=\{)(ol:[\w$]+,[^;]*?section:[\w$]+)(\};)/u.exec(code);

        if (table === null || !code.includes("createElement,"))
          this.error(`${id} no longer lists its default components as expected`);

        const [whole, open, entries, close] = table;
        const dropped: string[] = [];

        const kept = entries.replaceAll(
          /(^|,)(\w+):([\w$]+)(?=,|$)/gu,
          (entry, comma: string, tag: string, component: string) => {
            if (STREAMDOWN_DEFAULTS.has(tag)) return entry;
            dropped.push(component);

            return `${comma}${tag}:nytePlain(${JSON.stringify(tag)})`;
          },
        );

        const unnamed = dropped.reduce(
          (text, component) => {
            const named = `${component}.displayName="`;
            const at = text.indexOf(named);
            const end = text.indexOf('";', at);

            if (at === -1 || text.includes(named, end))
              this.error(`${id} no longer names its default component ${component} once`);

            return `${text.slice(0, at)}${text.slice(end + 2)}`;
          },
          code.replace(whole, `${open}${kept}${close}`),
        );

        return {
          code: `${unnamed.replaceAll(/=(memo|lazy|createContext)\(/gu, "=/* @__PURE__ */$1(")}\n${PLAIN_COMPONENT}`,
          map: null,
        };
      },
    },
  };
}

interface DeferredEntry {
  readonly module: string;
  readonly packages: readonly string[];
}

const DEFERRED_URLS = normalizePath(
  fileURLToPath(new URL("./src/lib/deferred-urls.ts", import.meta.url)),
);

export function deferredChunks(entries: Readonly<Record<string, DeferredEntry>>): Plugin {
  const modules = Object.entries(entries).map(
    ([name, entry]) => [name, normalizePath(fileURLToPath(entry.module))] as const,
  );

  const deferredModules = new Set(modules.map(([, module]) => module));

  const forbidden = Object.values(entries).flatMap((entry) =>
    entry.packages.map((path) => `/node_modules/${path}`),
  );

  let serving = false;

  return {
    name: "nyte:deferred-chunks",
    configResolved(config) {
      serving = config.command === "serve";
    },
    load(id) {
      if (normalizePath(id.split("?", 1)[0] ?? id) !== DEFERRED_URLS) return;

      const urls = modules.map(([name, module]) => {
        const url = serving
          ? JSON.stringify(`/@fs/${module}`)
          : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "chunk", id: module, name })}`;

        return `${JSON.stringify(name)}: ${url}`;
      });

      return `export default { ${urls.join(", ")} };`;
    },
    generateBundle(_options, bundle) {
      const startup = Object.values(bundle)
        .filter(
          (output) =>
            output.type === "chunk" &&
            output.isEntry &&
            !deferredModules.has(output.facadeModuleId ?? ""),
        )
        .map((output) => output.fileName);

      const visited = new Set<string>();

      for (const file of startup) {
        if (visited.has(file)) continue;
        visited.add(file);
        const chunk = bundle[file];

        if (chunk?.type !== "chunk") continue;

        const leaked = Object.keys(chunk.modules).find((id) =>
          forbidden.some((path) => id.includes(path)),
        );

        if (leaked !== undefined) {
          this.error(`${leaked} reached the startup chunks; load it through its deferred entry`);
        }

        startup.push(...chunk.imports);
      }
    },
  };
}

export function fileStructureLicenses(): Plugin {
  const directory = new URL("./src/workbench/editor/grammars/", import.meta.url);

  return {
    name: "nyte:file-structure-licenses",
    apply: "build",
    async generateBundle() {
      const files = [
        "NOTICE.txt",
        "manifest.json",
        ...(await readdir(new URL("licenses/", directory))).map((file) => `licenses/${file}`),
      ];

      for (const file of files) {
        this.emitFile({
          type: "asset",
          fileName: `assets/file-structure/${file}`,
          source: await readFile(new URL(file, directory)),
        });
      }
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

function parseRows(body: string): readonly DevRow[] {
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
            accept(parseRows(Buffer.concat(chunks).toString("utf8")));
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
