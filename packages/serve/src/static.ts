import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** The built web app under `root`; any other GET outside `/v1` answers `index.html`. */
export function createStaticHandler(
  root: string,
): (request: Request) => Promise<Response | undefined> {
  const base = resolve(root);
  const index = join(base, "index.html");

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const { pathname } = new URL(request.url);

    if (pathname === "/v1" || pathname.startsWith("/v1/")) return undefined;
    let path = index;

    try {
      const candidate = resolve(base, `.${decodeURIComponent(pathname)}`);
      const inside = relative(base, candidate);

      if (
        inside !== "" &&
        !inside.startsWith("..") &&
        !isAbsolute(inside) &&
        (await isFile(candidate))
      ) {
        path = candidate;
      }
    } catch {
      // A malformed escape names no file.
    }

    const headers = new Headers({
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    });

    if (path === index) headers.set("cache-control", "no-cache");
    else if (path.startsWith(join(base, "assets") + sep)) {
      headers.set("cache-control", "public, max-age=31536000, immutable");
    }

    return new Response(await openAsBlob(path), { headers });
  };
}
