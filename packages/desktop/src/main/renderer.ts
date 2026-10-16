import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol, session } from "electron";
import {
  rendererContentSecurityPolicy,
  resolveRendererFile,
  shellContentSecurityPolicy,
} from "../account/policy.ts";
import { ACCOUNT_HOST, CANVAS_HOST } from "../account/scheme.ts";
import type { accountScheme } from "../account/scheme.ts";

export function canvasShellUrl(scheme: ReturnType<typeof accountScheme>): string {
  return `${scheme}://${CANVAS_HOST}/index.html`;
}

export function registerRenderer(input: {
  readonly scheme: ReturnType<typeof accountScheme>;
  readonly frontendApiHost: string | undefined;
  readonly shellRoot: string;
}): string {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: input.scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // The renderer bundle is served by this scheme; without this a launch
        // compiles it again, which file: URLs never did.
        codeCache: true,
      },
    },
  ]);

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;

  const developmentOrigin =
    developmentUrl === undefined ? undefined : new URL(developmentUrl).origin;

  const rendererOrigin = developmentOrigin ?? `${input.scheme}://${ACCOUNT_HOST}`;

  const policies = {
    [ACCOUNT_HOST]: rendererContentSecurityPolicy({
      frontendApiHost: input.frontendApiHost,
      developmentOrigin,
      canvasOrigin: `${input.scheme}://${CANVAS_HOST}`,
    }),
    [CANVAS_HOST]: shellContentSecurityPolicy({ frameAncestor: rendererOrigin }),
  };

  void app.whenReady().then(() => {
    if (developmentOrigin !== undefined) {
      session.defaultSession.webRequest.onHeadersReceived(
        { urls: [`${developmentOrigin}/*`] },
        (details, callback) => {
          callback({
            responseHeaders:
              details.resourceType === "mainFrame"
                ? {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [policies[ACCOUNT_HOST]],
                  }
                : details.responseHeaders,
          });
        },
      );
    }

    const roots = {
      [ACCOUNT_HOST]:
        developmentOrigin === undefined ? join(import.meta.dirname, "../renderer") : undefined,
      [CANVAS_HOST]: input.shellRoot,
    };

    protocol.handle(input.scheme, async (request) => {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const target = resolveRendererFile(roots, request.url);

      if (target.kind === "refused") return new Response(null, { status: target.status });

      try {
        const response = await net.fetch(pathToFileURL(target.path).toString());

        if (!target.html && target.host === ACCOUNT_HOST) return response;
        const headers = new Headers(response.headers);

        // The sandboxed frame's origin is opaque, so the shell's module
        // script, stylesheet and fonts are CORS requests.
        if (target.host === CANVAS_HOST) headers.set("Access-Control-Allow-Origin", "*");

        if (target.html) headers.set("Content-Security-Policy", policies[target.host]);

        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
  });

  return developmentUrl ?? `${input.scheme}://${ACCOUNT_HOST}/`;
}
