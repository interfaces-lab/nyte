import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import type { TProperties } from "typebox";
import { Compile } from "typebox/compile";
import { ACCOUNT_HOST } from "./scheme.ts";

const PUBLISHABLE_KEY = /^pk_(?:test|live)_([A-Za-z0-9+/_-]+={0,2})$/u;

const HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/iu;

/**
 * Clerk loads its UI from the host the publishable key encodes, so a CSP built
 * from a different `frontendApiHost` would block it. Refuse the mismatch at
 * startup instead of shipping a window that never renders.
 */
export function checkedFrontendApiHost(config: {
  readonly publishableKey: string;
  readonly frontendApiHost: string;
}): string {
  const encoded = PUBLISHABLE_KEY.exec(config.publishableKey)?.[1];

  if (encoded === undefined) throw new Error("The Clerk publishable key is malformed.");

  if (!HOST.test(config.frontendApiHost)) {
    throw new Error(
      "The Clerk Frontend API host must be a bare host name, such as clerk.example.com.",
    );
  }

  if (Buffer.from(encoded, "base64").toString("utf8") !== `${config.frontendApiHost}$`) {
    throw new Error("The Clerk publishable key names a different Frontend API host.");
  }

  return config.frontendApiHost;
}

export function rendererContentSecurityPolicy(input: {
  readonly frontendApiHost: string | undefined;
  readonly developmentOrigin: string | undefined;
}): string {
  const api = input.frontendApiHost === undefined ? "" : ` https://${input.frontendApiHost}`;

  const challenges =
    input.frontendApiHost === undefined
      ? ""
      : " https://challenges.cloudflare.com https://*.protect.clerk.com";

  const development = input.developmentOrigin;
  const evaluation = development === undefined ? "" : " 'unsafe-eval'";
  const socket = development === undefined ? "" : ` ${development.replace(/^http/u, "ws")}`;

  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${api === "" ? "" : " 'unsafe-inline'"}${evaluation}${api}${challenges}`,
    `connect-src 'self'${api}${api === "" ? "" : " https://*.protect.clerk.com:*"}${socket}`,
    `img-src 'self' data: blob: https://avatars.githubusercontent.com${api === "" ? "" : " https://img.clerk.com"}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `frame-src 'self'${challenges}`,
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export type RendererFile =
  | { readonly kind: "file"; readonly path: string; readonly html: boolean }
  | { readonly kind: "refused"; readonly status: 400 | 403 | 404 };

export function resolveRendererFile(root: string, requestUrl: string): RendererFile {
  const url = new URL(requestUrl);

  if (url.host !== ACCOUNT_HOST) return { kind: "refused", status: 404 };
  let pathname: string;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { kind: "refused", status: 400 };
  }

  if (pathname === "/" || pathname === "/index.html") {
    return { kind: "file", path: join(root, "index.html"), html: true };
  }

  if (!pathname.startsWith("/assets/")) return { kind: "refused", status: 404 };
  const assets = join(root, "assets");
  const target = resolve(assets, `.${pathname.slice("/assets".length)}`);
  const inside = relative(assets, target);

  if (inside === "" || inside.split(sep)[0] === ".." || isAbsolute(inside)) {
    return { kind: "refused", status: 403 };
  }

  return { kind: "file", path: target, html: false };
}

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

const id = Type.String({ minLength: 1, maxLength: 64 });

export const accountAnswer = Compile(
  Type.Union([
    strict({
      id,
      kind: Type.Literal("token"),
      token: Type.String({
        maxLength: 16_384,
        pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
      }),
    }),
    strict({ id, kind: Type.Literal("signed_out") }),
    strict({ id, kind: Type.Literal("cancelled") }),
    strict({
      id,
      kind: Type.Literal("failed"),
      reason: Type.Union([
        Type.Literal("impersonated"),
        Type.Literal("no_token"),
        Type.Literal("sign_out_failed"),
        Type.Literal("unreachable"),
      ]),
    }),
  ]),
);

export const accountReport = Compile(
  Type.Union([
    strict({
      kind: Type.Literal("signed_in"),
      label: Type.String({ minLength: 1, maxLength: 320 }),
    }),
    strict({ kind: Type.Literal("signed_out") }),
    strict({ kind: Type.Literal("unreachable") }),
  ]),
);

export type AccountAnswer = ReturnType<typeof accountAnswer.Parse>;

export type AccountReport = ReturnType<typeof accountReport.Parse>;
