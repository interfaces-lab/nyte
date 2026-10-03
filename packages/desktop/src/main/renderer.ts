import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol, session } from "electron";
import { rendererContentSecurityPolicy, resolveRendererFile } from "../account/policy.ts";
import { ACCOUNT_HOST } from "../account/scheme.ts";
import type { accountScheme } from "../account/scheme.ts";

export function registerRenderer(input: {
  readonly scheme: ReturnType<typeof accountScheme>;
  readonly frontendApiHost: string | undefined;
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
      },
    },
  ]);

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;

  const policy = rendererContentSecurityPolicy({
    frontendApiHost: input.frontendApiHost,
    developmentOrigin: developmentUrl === undefined ? undefined : new URL(developmentUrl).origin,
  });

  void app.whenReady().then(() => {
    if (developmentUrl !== undefined) {
      session.defaultSession.webRequest.onHeadersReceived(
        { urls: [`${new URL(developmentUrl).origin}/*`] },
        (details, callback) => {
          callback({
            responseHeaders:
              details.resourceType === "mainFrame"
                ? { ...details.responseHeaders, "Content-Security-Policy": [policy] }
                : details.responseHeaders,
          });
        },
      );

      return;
    }

    const root = join(app.getAppPath(), "out", "renderer");

    protocol.handle(input.scheme, async (request) => {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const target = resolveRendererFile(root, request.url);

      if (target.kind === "refused") return new Response(null, { status: target.status });

      try {
        const response = await net.fetch(pathToFileURL(target.path).toString());

        if (!target.html) return response;
        const headers = new Headers(response.headers);

        headers.set("Content-Security-Policy", policy);

        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
  });

  return developmentUrl ?? `${input.scheme}://${ACCOUNT_HOST}/`;
}
