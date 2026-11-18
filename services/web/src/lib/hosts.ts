import type { LocationRewrite } from "@tanstack/react-router";
import { designRoute, designUrl } from "./shared";

const designPrefix = "design.";

const hostsWithDesign = new Set(["nyte.sh", "localhost"]);

const sharedPaths = [
  "/api/",
  "/og/",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/",
  "/mcp",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image.png",
];

function servesDesign(hostname: string): boolean {
  return hostname.startsWith(designPrefix) && hostsWithDesign.has(mainHostname(hostname));
}

function mainHostname(designHostname: string): string {
  return designHostname.slice(designPrefix.length);
}

function servedOnEveryHost(pathname: string): boolean {
  return sharedPaths.some((path) => pathname.startsWith(path));
}

function inDesignRoute(pathname: string): boolean {
  return pathname === designRoute || pathname.startsWith(`${designRoute}/`);
}

function stripDesignRoute(pathname: string): string {
  return pathname.slice(designRoute.length) || "/";
}

function toInternal(url: URL): URL {
  if (!servesDesign(url.hostname) || servedOnEveryHost(url.pathname)) return url;
  url.pathname = url.pathname === "/" ? designRoute : `${designRoute}${url.pathname}`;
  return url;
}

function toPublic(url: URL): URL {
  if (servesDesign(url.hostname)) {
    if (inDesignRoute(url.pathname)) url.pathname = stripDesignRoute(url.pathname);
    else if (!servedOnEveryHost(url.pathname)) url.hostname = mainHostname(url.hostname);
    return url;
  }
  if (inDesignRoute(url.pathname) && hostsWithDesign.has(url.hostname)) {
    url.hostname = `${designPrefix}${url.hostname}`;
    url.pathname = stripDesignRoute(url.pathname);
  }
  return url;
}

export const hostRewrite: LocationRewrite = {
  input: ({ url }) => toInternal(url),
  output: ({ url }) => toPublic(url),
};

export function canonicalRedirect(requestUrl: string): URL | undefined {
  const url = new URL(requestUrl);
  if (servesDesign(url.hostname) || !hostsWithDesign.has(url.hostname)) return undefined;
  if (!inDesignRoute(url.pathname)) return undefined;
  return toPublic(url);
}

export function mainOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (servesDesign(url.hostname)) url.hostname = mainHostname(url.hostname);
  return url.origin;
}

export function designPublicUrl(pathname: string): string {
  return `${designUrl}${stripDesignRoute(pathname)}`;
}
