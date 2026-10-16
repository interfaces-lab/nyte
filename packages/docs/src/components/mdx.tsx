import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { MDXComponents } from "mdx/types";
import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { CodeFrame } from "~/components/site/code-frame";
import { splitHref } from "~/lib/href";
import { componentsMdxComponents } from "~/components/components/mdx";
import { foundationsMdxComponents } from "~/components/design/mdx";
import { DocCard } from "~/components/mdx/doc-card";
import { DesktopDownload } from "~/components/mdx/install";
import { Mermaid } from "~/components/mdx/mermaid";

function Anchor({ href = "", className, ...rest }: ComponentProps<"a">) {
  const scopedClass = [props(intent.primary).className, className].filter(Boolean).join(" ");
  if (href.startsWith("#")) return <a href={href} {...rest} className={scopedClass} />;
  if (href.startsWith("/")) return <Link {...splitHref(href)} {...rest} className={scopedClass} />;
  return <a href={href} rel="noreferrer" target="_blank" {...rest} className={scopedClass} />;
}

function ScrollTable(props: ComponentProps<"table">) {
  return (
    <div className="doc-table-scroll">
      <table {...props} />
    </div>
  );
}

function Cards({ children }: { children?: ReactNode }) {
  return <div className="docs-cards">{children}</div>;
}

export const mdxComponents = {
  a: Anchor,
  pre: CodeFrame,
  table: ScrollTable,
  ...componentsMdxComponents,
  ...foundationsMdxComponents,
  Cards,
  DocCard,
  DesktopDownload,
  Mermaid,
} satisfies MDXComponents;

declare global {
  type MDXProvidedComponents = typeof mdxComponents;
}
