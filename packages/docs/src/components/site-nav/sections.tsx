import Link from "next/link";
import { docsRoute } from "~/lib/shared";

const itemClass =
  "inline-flex h-(--site-nav-control) items-center rounded-full px-2.5 text-[15px] font-medium text-foreground transition-colors hover:bg-current/10 hero:text-white";

export function SiteNavSections({ githubHref }: { githubHref: string }) {
  return (
    <nav aria-label="Site" className="flex items-center gap-0.5 justify-self-start max-lg:hidden">
      <Link href={docsRoute} className={itemClass}>
        Docs
      </Link>
      <a href={githubHref} target="_blank" rel="noreferrer" className={itemClass}>
        GitHub
      </a>
    </nav>
  );
}
