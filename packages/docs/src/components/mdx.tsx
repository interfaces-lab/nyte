import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import { DocCard } from "~/components/mdx/doc-card";
import { Mermaid } from "~/components/mdx/mermaid";
import { shellMdxComponents } from "~/components/shell/mdx";

function Cards({ children }: { children?: ReactNode }) {
  return <div className="docs-cards">{children}</div>;
}

/*
 * Core docs render MDX with their own elements. Headings keep the ids
 * fumadocs-mdx assigns so deep links still land.
 */
export function docsMdxComponents(): MDXComponents {
  return {
    ...shellMdxComponents("docs"),
    Cards,
    DocCard,
    Mermaid,
  };
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...docsMdxComponents(),
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
