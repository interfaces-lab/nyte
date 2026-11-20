export function splitHref(href: string): { to: string; hash: string | undefined } {
  const [to = href, ...hash] = href.split("#");
  return { to, hash: hash.length === 0 ? undefined : hash.join("#") };
}
