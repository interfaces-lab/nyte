import Link from "next/link";

interface PagerTarget {
  name?: unknown;
  url: string;
}

export function ShellPager({ previous, next }: { previous?: PagerTarget; next?: PagerTarget }) {
  if (!previous && !next) return null;

  return (
    <nav className="shell-pager" aria-label="Pages">
      {previous && typeof previous.name === "string" ? (
        <Link href={previous.url} data-dir="previous">
          <span className="shell-eyebrow">Previous</span>
          <strong>{previous.name}</strong>
        </Link>
      ) : null}
      {next && typeof next.name === "string" ? (
        <Link href={next.url} data-dir="next">
          <span className="shell-eyebrow">Next</span>
          <strong>{next.name}</strong>
        </Link>
      ) : null}
    </nav>
  );
}
