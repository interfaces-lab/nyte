import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description: "Install Nyte, run your first prompt, or build an agent app from the packages.",
};

const guides = [
  {
    href: "/docs/build/composition",
    title: "Build an agent app",
    description: "Run a host, then build a React chat or a terminal interface around it.",
  },
  {
    href: "/docs/build/sdk",
    title: "SDK",
    description: "Create sessions, send messages, and follow the conversation as it runs.",
  },
  {
    href: "/docs/kernel/architecture",
    title: "Kernel",
    description: "How Nyte stores conversations and resumes work across processes.",
  },
  {
    href: "/docs/components/introduction",
    title: "Components",
    description: "Tokens and styled components for building your interface with @nyte-ai/ui.",
  },
];

const actionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-subtle px-5 py-2.5 text-[15px] font-medium transition-colors hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

const codeClass =
  "mt-4 overflow-x-auto rounded-xl border border-border-subtle bg-fill-selected p-5 font-mono text-[14px]/7 text-foreground";

export default function DocsHomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-(--site-pad) pt-14 pb-24 sm:pt-20">
      <header className="border-b border-border-subtle pb-12 sm:pb-16">
        <h1 className="text-[clamp(2.25rem,1.5rem+2vw,3.5rem)] leading-tight font-medium tracking-[-0.03em]">
          Nyte docs
        </h1>
        <p className="mt-5 max-w-2xl text-[18px]/8 text-muted-foreground">
          Nyte runs agents in your terminal, on your desktop, or in your own app. Conversations are
          stored so you can return to them after the process stops.
        </p>
      </header>

      <section aria-labelledby="get-started" className="py-12 sm:py-16">
        <h2 id="get-started" className="scroll-mt-28 text-3xl font-medium tracking-tight">
          Get started
        </h2>
        <p className="mt-4 text-[17px]/7 text-muted-foreground">
          Download the desktop app or install the CLI. Both run the agent locally and save your
          sessions in SQLite.
        </p>

        <h3 className="mt-9 text-xl font-medium tracking-tight">Desktop app</h3>
        <p className="mt-3 text-[16px]/7 text-muted-foreground">
          For Apple Silicon Macs. Open the disk image and drag Nyte to Applications. No separate
          host installation needed.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <a
            href="https://github.com/interfaces-lab/nyte/releases/latest"
            className={`${actionClass} border-ring`}
          >
            Download for macOS
          </a>
          <Link href="/docs/build/composition" className={actionClass}>
            Build from source
          </Link>
        </div>

        <h3 className="mt-10 text-xl font-medium tracking-tight">CLI</h3>
        <p className="mt-3 text-[16px]/7 text-muted-foreground">
          For macOS and Linux, on arm64 and x64. The installer places the nyte binary on your PATH.
        </p>
        <pre className={codeClass}>
          <code>curl -fsSL https://nyte.sh/install | sh</code>
        </pre>
        <p className="mt-5 text-[16px]/7 text-muted-foreground">Sign in, then start a session:</p>
        <pre className={codeClass}>
          <code>{"nyte login\nnyte"}</code>
        </pre>
        <p className="mt-5 text-[16px]/7 text-muted-foreground">
          For a single prompt without the terminal interface, run{" "}
          <code className="font-mono text-[14px] text-foreground">
            nyte -p &quot;your prompt&quot;
          </code>
          . See the{" "}
          <a
            href="https://github.com/interfaces-lab/nyte/blob/main/packages/cli/docs/README.md"
            className="underline underline-offset-4 hover:text-foreground"
          >
            CLI user guide
          </a>{" "}
          for commands and configuration.
        </p>
      </section>

      <section aria-labelledby="guides" className="border-t border-border-subtle pt-12 sm:pt-16">
        <h2 id="guides" className="text-3xl font-medium tracking-tight">
          Explore the docs
        </h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {guides.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className="rounded-xl border border-border-subtle p-6 transition-colors hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <h3 className="text-lg font-medium">{guide.title}</h3>
              <p className="mt-3 text-[16px]/7 text-muted-foreground">{guide.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
