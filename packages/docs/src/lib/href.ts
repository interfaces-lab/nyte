/** An internal href as router `to` and `hash`: `/docs/x#install` → `/docs/x` and `install`. */
export function splitHref(href: string): { to: string; hash: string | undefined } {
  const [to = href, ...hash] = href.split("#");
  return { to, hash: hash.length === 0 ? undefined : hash.join("#") };
}
