const exact = new Map([
  ["/cloud", "/design"],
  ["/docs/components", "/design"],
  ["/docs/components/introduction", "/design"],
  ["/docs/components/components", "/design/components"],
  ["/docs/composition", "/docs/build/composition"],
  ["/docs/build/sdk", "/docs/sdk"],
  ["/docs/build/environments", "/docs/build/composition"],
  ["/docs/desktop", "/docs"],
  ["/docs/desktop/files", "/docs/desktop/editor"],
  ["/docs/build/desktop", "/docs"],
]);

const movedReference =
  /^\/(?:cloud|docs\/components)\/(?:foundations|components)\/([a-z0-9-]+)\/?$/;

export function retiredPathTarget(pathname: string): string | undefined {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const direct = exact.get(trimmed);
  if (direct) return direct;
  const [, name] = movedReference.exec(trimmed) ?? [];
  return name ? `/design/${name}` : undefined;
}
