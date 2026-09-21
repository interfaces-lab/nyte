import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentProps } from "react";
import { ShellCodeFrame } from "./code-frame";

function Anchor({ href = "", ...props }: ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) return <Link href={href} {...props} />;
  return <a href={href} rel="noreferrer" target="_blank" {...props} />;
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="shell-table-scroll">
      <table {...props} />
    </div>
  );
}

/*
 * The MDX elements both doc sections share. Headings keep the ids
 * fumadocs-mdx assigns so deep links still land.
 */
export function shellMdxComponents(): MDXComponents {
  return {
    a: Anchor,
    pre: ShellCodeFrame,
    table: Table,
  };
}
