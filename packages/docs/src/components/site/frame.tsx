import { FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { createContext } from "react";
import type { ReactNode } from "react";
import type { NavSection } from "~/lib/docs";

/** The frame's sidebar sections; `DocArticle` draws them beside the page, with its headings. */
export const DocSections = createContext<readonly NavSection[]>([]);

/** The docs frame under the site nav: sidebar, then the page. */
export function DocFrame({
  sections,
  children,
}: {
  sections: readonly NavSection[];
  children: ReactNode;
}) {
  return (
    <div className="doc flex min-w-0 flex-1 flex-col">
      <FileTypeIconSprite />
      <div className="doc-frame">
        <DocSections value={sections}>{children}</DocSections>
      </div>
    </div>
  );
}
