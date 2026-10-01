import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentProps } from "react";
import { CodeFrame } from "./code-frame";

function Anchor({ href = "", className, ...rest }: ComponentProps<"a">) {
  const scopedClass = [props(intent.primary).className, className].filter(Boolean).join(" ");
  if (href.startsWith("/") || href.startsWith("#"))
    return <Link href={href} {...rest} className={scopedClass} />;
  return <a href={href} rel="noreferrer" target="_blank" {...rest} className={scopedClass} />;
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="doc-table-scroll">
      <table {...props} />
    </div>
  );
}

/*
 * The MDX elements both doc sections share. Headings keep the ids
 * fumadocs-mdx assigns so deep links still land.
 */
export function sharedMdxComponents(): MDXComponents {
  return {
    a: Anchor,
    pre: CodeFrame,
    table: Table,
  };
}
