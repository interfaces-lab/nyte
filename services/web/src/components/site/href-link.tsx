import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { splitHref } from "~/lib/href";

export function HrefLink({ href, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) return <a href={href} {...rest} />;
  return <Link {...splitHref(href)} {...rest} />;
}
