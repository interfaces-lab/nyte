import { KERNEL, REVISION, sourceUrl } from "./source";

export function KernelHeader() {
  return (
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <a href={sourceUrl(KERNEL)} target="_blank" rel="noreferrer" className="font-mono">
        packages/{KERNEL} <span aria-hidden>↗</span>
      </a>
      <span>
        Read at{" "}
        <a
          href={`https://github.com/interfaces-lab/nyte/commit/${REVISION}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono"
        >
          {REVISION.slice(0, 7)}
        </a>
      </span>
    </div>
  );
}
