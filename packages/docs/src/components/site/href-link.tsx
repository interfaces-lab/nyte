import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { splitHref } from "~/lib/href";

/**
 * A link for an href of any kind: a site path goes through the router, so it
 * can cross to the design host; an external URL or a bare `#hash` stays a plain anchor.
 */
export function HrefLink({ href, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) return <a href={href} {...rest} />;
  return <Link {...splitHref(href)} {...rest} />;
}
