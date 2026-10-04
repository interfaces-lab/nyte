import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import { DocCard } from "~/components/mdx/doc-card";
import { Mermaid } from "~/components/mdx/mermaid";
import { sharedMdxComponents } from "~/app/(site)/_layout/mdx";

import { Source, Sketch, Diff } from "~/components/mdx/kernel/code";
import { Cas, LayerStack, Trace, TraceStep } from "~/components/mdx/kernel/figures";
import { Quiz } from "~/components/mdx/kernel/quiz";
import { Constants, Functions, OpenIssues } from "~/components/mdx/kernel/reference";
import { C, Codes, Inline, P, Src, Table, To } from "~/components/mdx/kernel/ui";

function Cards({ children }: { children?: ReactNode }) {
  return <div className="docs-cards">{children}</div>;
}

/*
 * Core docs render MDX with their own elements. Headings keep the ids
 * fumadocs-mdx assigns so deep links still land.
 */
export function docsMdxComponents(): MDXComponents {
  return {
    ...sharedMdxComponents(),
    Cards,
    DocCard,
    Mermaid,
    Source,
    Sketch,
    Diff,
    Cas,
    LayerStack,
    Trace,
    TraceStep,
    Quiz,
    Constants,
    Functions,
    OpenIssues,
    C,
    Codes,
    Inline,
    P,
    Src,
    Table,
    To,
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
