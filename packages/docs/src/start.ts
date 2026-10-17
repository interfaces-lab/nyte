import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { canonicalRedirect } from "~/lib/hosts";
import { retiredPathTarget } from "~/lib/redirects";

/** Retired paths and design pages on the main host answer with one permanent redirect. */
const placement = createMiddleware().server(({ request, next }) => {
  const url = new URL(request.url);
  const retired = retiredPathTarget(url.pathname);
  if (retired) url.pathname = retired;
  const target = canonicalRedirect(url.href) ?? (retired ? url : undefined);
  if (target) return Response.redirect(target, 308);
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" }),
    placement,
  ],
}));
