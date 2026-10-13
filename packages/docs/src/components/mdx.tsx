import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CodeFrame } from "~/app/(site)/_layout/code-frame";
import { componentsMdxComponents } from "~/components/components/mdx";
import { DocCard } from "~/components/mdx/doc-card";
import { DesktopDownload } from "~/components/mdx/install";
import { Mermaid } from "~/components/mdx/mermaid";

function Anchor({ href = "", className, ...rest }: ComponentProps<"a">) {
  const scopedClass = [props(intent.primary).className, className].filter(Boolean).join(" ");
  if (href.startsWith("/") || href.startsWith("#"))
    return <Link href={href} {...rest} className={scopedClass} />;
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

/* Every element and component a docs page can use. Headings keep the ids the compiler assigns. */
export const mdxComponents = {
  a: Anchor,
  pre: CodeFrame,
  table: ScrollTable,
  ...componentsMdxComponents,
  Cards,
  DocCard,
  DesktopDownload,
  Mermaid,
} satisfies MDXComponents;

declare global {
  type MDXProvidedComponents = typeof mdxComponents;
}
