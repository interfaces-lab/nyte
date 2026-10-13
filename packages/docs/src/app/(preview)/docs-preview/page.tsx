import Link from "next/link";
import { AsciiMoon } from "~/components/landing/hero-5/ascii-moon";
import { CoreGrid } from "~/components/landing/hero-5/core-mosaic";
import { brandTileClass } from "~/components/landing/hero-5/section";
import { githubUrl } from "~/lib/shared";

export default function DocsPreviewPage() {
  return (
    <div className="flex flex-col gap-12">
      <Link
        href={githubUrl}
        aria-label="Nyte on GitHub, MIT license"
        className={`group/nyte flex aspect-video flex-col justify-between p-6 ${brandTileClass}`}
      >
        <AsciiMoon className="w-1/4 self-end transition-transform duration-500 ease-nav group-hover/nyte:-translate-y-1 motion-reduce:transition-none" />
        <span>
          <span className="block text-[15px]/5 font-medium">Nyte</span>
          <span className="block font-mono text-[11px]/4 text-white/70">MIT · GitHub</span>
        </span>
      </Link>

      <section aria-labelledby="cores-title" className="flex flex-col gap-6">
        <CoreGrid />
        <div className="flex flex-col gap-2">
          <h2 id="cores-title" className="leading-[18px] font-medium">
            Countless cores.
          </h2>
          <p className="text-sm/[22px] text-muted-foreground">
            Each one fits the harness it was written for.
          </p>
        </div>
      </section>
    </div>
  );
}
