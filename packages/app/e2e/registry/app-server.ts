/**
 * The built web app on a loopback port of its own, as app.nyte.sh serves it:
 * the production static handler with the headers the build's `vercel.json`
 * sets, CSP included. A registry host is another origin, as it is for the
 * hosted app. Playwright starts this and reads the origin from its output.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import process from "node:process";
import { inspect } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
// Relative: the app cannot depend on serve or server, which depend on it.
import { requestListener } from "../../../server/src/node.ts";
import { createStaticHandler } from "../../../serve/src/static.ts";

/** Every header rule in the build's `vercel.json` covers every path; another source would need matching here. */
const HostingConfig = Type.Object({
  headers: Type.Array(
    Type.Object({
      source: Type.Literal("/(.*)"),
      headers: Type.Array(Type.Object({ key: Type.String(), value: Type.String() })),
    }),
  ),
});

const root = resolve(process.env.NYTE_REGISTRY_APP_DIST ?? join(import.meta.dirname, "../../dist"));

if (!existsSync(join(root, "index.html"))) {
  process.stderr.write(
    `No built app at ${root}. Build it without account sign-in: VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app exec vite build --outDir <dir>, then set NYTE_REGISTRY_APP_DIST=<dir>.\n`,
  );
  process.exit(1);
}

const hosting: unknown = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));

if (!Value.Check(HostingConfig, hosting)) {
  process.stderr.write(
    `${join(root, "vercel.json")} no longer has the shape this server applies\n`,
  );
  process.exit(1);
}

const productionHeaders = hosting.headers.flatMap((rule) => rule.headers);

const serveApp = createStaticHandler(root);

const server = createServer(
  requestListener(
    async (request) => {
      const response = (await serveApp(request)) ?? new Response(null, { status: 404 });
      const headers = new Headers(response.headers);

      for (const { key, value } of productionHeaders) headers.set(key, value);

      return new Response(response.body, { status: response.status, headers });
    },
    { onError: (cause) => process.stderr.write(`app server: ${inspect(cause)}\n`) },
  ),
);

const Listening = Type.Object({ port: Type.Integer() });

server.listen(0, "127.0.0.1", () => {
  const address = server.address();

  if (!Value.Check(Listening, address)) throw new Error("Not a TCP listener");
  process.stdout.write(`Serving the app at http://127.0.0.1:${String(address.port)}\n`);
});

const stop = (): void => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
};

process.once("SIGTERM", stop);

process.once("SIGINT", stop);
