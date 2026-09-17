import Link from "next/link";
import type { ShellSkin } from "~/shell.stylex";

interface PagerTarget {
  name?: unknown;
  url: string;
}

export function ShellPager({
  skin,
  previous,
  next,
}: {
  skin: ShellSkin;
  previous?: PagerTarget;
  next?: PagerTarget;
}) {
  if (!previous && !next) return null;

  return (
    <nav className={`${skin}-pager`} aria-label="Pages">
      {previous && typeof previous.name === "string" ? (
        <Link href={previous.url} data-dir="previous">
          <span className={`${skin}-eyebrow`}>Previous</span>
          <strong>{previous.name}</strong>
        </Link>
      ) : null}
      {next && typeof next.name === "string" ? (
        <Link href={next.url} data-dir="next">
          <span className={`${skin}-eyebrow`}>Next</span>
          <strong>{next.name}</strong>
        </Link>
      ) : null}
    </nav>
  );
}
