/** An internal href as router `to` and `hash`: `/docs/x#install` → `/docs/x` and `install`. */
export function splitHref(href: string): { to: string; hash: string | undefined } {
  const index = href.indexOf("#");
  if (index < 0) return { to: href, hash: undefined };
  return { to: href.slice(0, index), hash: href.slice(index + 1) };
}
