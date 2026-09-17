import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentProps } from "react";
import type { ShellSkin } from "~/shell.stylex";
import { ShellCodeFrame, type ShellCodeFrameProps } from "./code-frame";

function Anchor({ href = "", ...props }: ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) return <Link href={href} {...props} />;
  return <a href={href} rel="noreferrer" target="_blank" {...props} />;
}

/*
 * The MDX elements both doc sections share. The skin name is the only
 * input: elements take `${skin}-*` classes and each section's stylesheet
 * owns the look. Headings keep the ids fumadocs-mdx assigns so deep links
 * still land.
 */
export function shellMdxComponents(skin: ShellSkin): MDXComponents {
  function CodeFrame(props: Omit<ShellCodeFrameProps, "skin">) {
    return <ShellCodeFrame skin={skin} {...props} />;
  }

  function Table(props: ComponentProps<"table">) {
    return (
      <div className={`${skin}-table-scroll`}>
        <table {...props} />
      </div>
    );
  }

  return {
    a: Anchor,
    pre: CodeFrame,
    table: Table,
  };
}
