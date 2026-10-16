const exact = new Map([
  ["/cloud", "/design"],
  ["/docs/components", "/design"],
  ["/docs/components/introduction", "/design"],
  ["/docs/components/components", "/design/components"],
  ["/docs/composition", "/docs/build/composition"],
  ["/docs/sdk", "/docs/build/composition"],
  ["/docs/build/sdk", "/docs/build/composition"],
  ["/docs/build/environments", "/docs/build/composition"],
  ["/docs/desktop", "/docs"],
  ["/docs/build/desktop", "/docs"],
]);

/** The component reference moved from /docs/components (and before that /cloud) to the design site. */
const movedReference =
  /^\/(?:cloud|docs\/components)\/(?:foundations|components)\/([a-z0-9-]+)\/?$/;

/** The current path for a retired one, or undefined. */
export function retiredPathTarget(pathname: string): string | undefined {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const direct = exact.get(trimmed);
  if (direct) return direct;
  const [, name] = movedReference.exec(trimmed) ?? [];
  return name ? `/design/${name}` : undefined;
}
