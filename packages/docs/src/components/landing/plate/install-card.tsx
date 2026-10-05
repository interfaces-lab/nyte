import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { IconArrowDown } from "central-icons";
import Link from "next/link";
import { latestMacRelease, releasesUrl } from "~/lib/releases";
import { CopyCommand } from "./copy-command";
import { ScanMoon } from "./scan-moon";

export async function InstallCard() {
  const release = await latestMacRelease();

  return (
    <section
      id="install"
      className="group relative isolate scroll-mt-6 overflow-hidden rounded-[20px] bg-(--site-panel) after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle"
    >
      <ScanMoon
        rows={64}
        className="pointer-events-none absolute right-[4%] -bottom-[42%] -z-10 w-[min(460px,72%)] text-foreground/30 transition-transform duration-700 ease-nav group-focus-within:-translate-y-3 group-hover:-translate-y-3 motion-reduce:transition-none max-sm:-right-[22%] max-sm:-bottom-[30%] max-sm:opacity-60"
      />

      <div className="flex flex-col items-start px-6 py-12 sm:px-12 sm:py-16">
        <h2 className="font-display text-[32px]/[1.1] font-medium tracking-[-0.03em]">
          Download Nyte
        </h2>
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
        <a
          href={release?.downloadUrl ?? `${releasesUrl}/latest`}
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-foreground pr-5 pl-4 text-[15px] font-medium text-background outline-none transition-[background-color,scale] active:scale-[0.96] hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <IconArrowDown size={16} />
          Download for Mac
        </a>
        <p className="mt-3 text-[13px]/5 text-muted-foreground">
          Apple Silicon. Other distributions are coming.
        </p>

        <p className="mt-12 text-[13px]/5 text-muted-foreground">
          Or install the CLI on macOS or Linux
        </p>
        <div className="mt-2 max-w-full">
          <CopyCommand command="curl -fsSL https://nyte.sh/install | sh" />
        </div>
        <p className="mt-4 text-[13px]/5 text-muted-foreground">
          Building a host?{" "}
          <Link
            href="/docs/build/sdk"
            {...props(intent.primary)}
            className="text-muted-foreground hover:underline"
          >
            Read the SDK
          </Link>
        </p>
      </div>
    </section>
  );
}
