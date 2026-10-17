import { Link } from "@tanstack/react-router";
import { ProductMenu } from "./product-menu";

const itemClass =
  "inline-flex h-(--site-nav-control) items-center rounded-full px-2.5 text-[15px] font-medium text-foreground transition-colors hover:bg-current/10 data-[status=active]:bg-current/10 hero:text-white";

export function SiteNavSections({ githubHref }: { githubHref: string }) {
  return (
    <nav aria-label="Site" className="flex items-center gap-0.5 justify-self-start max-lg:hidden">
      <ProductMenu triggerClass={itemClass} />
      <Link to="/docs/$" className={itemClass}>
        Docs
      </Link>
      <Link to="/design/$" className={itemClass}>
        Design
      </Link>
      <a href={githubHref} target="_blank" rel="noreferrer" className={itemClass}>
        GitHub
      </a>
    </nav>
  );
}
