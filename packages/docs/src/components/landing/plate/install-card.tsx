import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import Link from "next/link";
import { latestMacRelease, releasesUrl } from "~/lib/releases";
import { CopyCommand } from "./copy-command";
import { DitherMoon } from "./dither-moon";
import { DownloadButton } from "./download-button";

const tileClass = "size-8 shrink-0 rounded-[9px] bg-muted ring-1 ring-border-subtle ring-inset";

export async function InstallCard() {
  const release = await latestMacRelease();

  return (
    <section
      id="install"
      className="relative flex scroll-mt-6 flex-col items-center overflow-hidden px-6 py-12 text-center"
    >
      <div aria-hidden="true" className="relative flex h-24 w-full items-center justify-center">
        <div className="install-halo absolute top-1/2 left-1/2 h-[240px] w-[min(520px,130%)] -translate-x-1/2 -translate-y-1/2" />

        <div className="absolute inset-x-0 top-1/2 h-20 -translate-y-1/2 [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]">
          <div className="absolute inset-x-0 top-2 h-4 bg-[linear-gradient(90deg,#f472b6,#a78bfa,#60a5fa)] opacity-60 blur-md" />
          <div className="absolute inset-x-0 bottom-2 h-4 bg-[linear-gradient(90deg,#a78bfa,#60a5fa,#22d3ee)] opacity-60 blur-md" />
          <div className="absolute inset-x-0 inset-y-4 bg-background" />
        </div>

        <div className="relative flex items-center gap-1.5">
          <div className="flex gap-1.5 [mask-image:linear-gradient(to_right,transparent,black)]">
            {[0, 1, 2, 3, 4].map((tile) => (
              <span key={tile} className={tileClass} />
            ))}
          </div>
          <div className="grid size-14 shrink-0 place-items-center rounded-[15px] bg-[linear-gradient(180deg,#232a44,#0c1020)] text-[#c1d0f6] shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_0_0_1px_rgb(255_255_255/0.06),0_12px_24px_-10px_rgb(12_16_32/0.6),0_2px_4px_rgb(12_16_32/0.2)]">
            <DitherMoon cells={12} pixel={3} />
          </div>
          <div className="flex gap-1.5 [mask-image:linear-gradient(to_left,transparent,black)]">
            {[0, 1, 2, 3, 4].map((tile) => (
              <span key={tile} className={tileClass} />
            ))}
          </div>
        </div>
      </div>

      <h2 className="mt-8 font-display text-[32px]/[1.1] font-medium tracking-[-0.03em]">
        Download Nyte
      </h2>
      <div className="mt-6">
        <DownloadButton href={release?.downloadUrl ?? `${releasesUrl}/latest`} />
      </div>
      <p className="mt-3 text-[13px]/5 text-muted-foreground">
        {release ? `${release.version} · ` : null}
        <a
          href={release?.notesUrl ?? releasesUrl}
          {...props(intent.primary)}
          className="text-muted-foreground hover:underline"
        >
          Release notes
        </a>
      </p>

      <p className="mt-10 text-[13px]/5 text-muted-foreground">Or install the CLI</p>
      <div className="mt-2 max-w-full">
        <CopyCommand command="curl -fsSL https://nyte.sh/install | sh" />
      </div>
      <p className="mt-4 text-[13px]/5 text-muted-foreground">
        Building a host?{" "}
        <Link
          href="/docs/sdk"
          {...props(intent.primary)}
          className="text-muted-foreground hover:underline"
        >
          Read the SDK
        </Link>
      </p>
    </section>
  );
}
