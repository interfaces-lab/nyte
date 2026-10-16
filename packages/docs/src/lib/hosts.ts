import type { LocationRewrite } from "@tanstack/react-router";
import { designRoute, designUrl } from "./shared";

/*
 * One deployment serves two hosts. `design.nyte.sh/button` is the internal
 * route `/design/button`; `nyte.sh/design/button` redirects there. Locally,
 * `design.localhost` plays the subdomain. Hosts without a design subdomain,
 * such as Vercel previews, keep `/design` as a plain path.
 */

const designPrefix = "design.";

const hostsWithDesign = new Set(["nyte.sh", "localhost"]);

/* Server routes every host answers at the same path. */
const sharedPaths = [
  "/api/",
  "/og/",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image.png",
];

export function isDesignHost(hostname: string): boolean {
  return hostname.startsWith(designPrefix) && hostsWithDesign.has(mainHostname(hostname));
}

function mainHostname(designHostname: string): string {
  return designHostname.slice(designPrefix.length);
}

function isSharedPath(pathname: string): boolean {
  return sharedPaths.some((path) => pathname.startsWith(path));
}

function isDesignPath(pathname: string): boolean {
  return pathname === designRoute || pathname.startsWith(`${designRoute}/`);
}

function stripDesignRoute(pathname: string): string {
  return pathname.slice(designRoute.length) || "/";
}

/** The router's view of a design-host URL: `/button` becomes `/design/button`. */
function toInternal(url: URL): URL {
  if (!isDesignHost(url.hostname) || isSharedPath(url.pathname)) return url;
  url.pathname = url.pathname === "/" ? designRoute : `${designRoute}${url.pathname}`;
  return url;
}

/** The public URL for an internal path, which may sit on the other host. */
function toPublic(url: URL): URL {
  if (isDesignHost(url.hostname)) {
    if (isDesignPath(url.pathname)) url.pathname = stripDesignRoute(url.pathname);
    else if (!isSharedPath(url.pathname)) url.hostname = mainHostname(url.hostname);
    return url;
  }
  if (isDesignPath(url.pathname) && hostsWithDesign.has(url.hostname)) {
    url.hostname = `${designPrefix}${url.hostname}`;
    url.pathname = stripDesignRoute(url.pathname);
  }
  return url;
}

export const hostRewrite: LocationRewrite = {
  input: ({ url }) => toInternal(url),
  output: ({ url }) => toPublic(url),
};

/**
 * Where a request belongs when it arrived on the wrong host: `/design/*` on the
 * main host moves to the design subdomain. Undefined when it is already home.
 */
export function canonicalRedirect(requestUrl: string): URL | undefined {
  const url = new URL(requestUrl);
  if (isDesignHost(url.hostname) || !hostsWithDesign.has(url.hostname)) return undefined;
  if (!isDesignPath(url.pathname)) return undefined;
  return toPublic(url);
}

/** The production URL of an internal design path: `/design/button` → `https://design.nyte.sh/button`. */
export function designPublicUrl(pathname: string): string {
  return `${designUrl}${stripDesignRoute(pathname)}`;
}
