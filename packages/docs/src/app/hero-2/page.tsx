import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Cadence } from "@/components/hero-2/cadence";
import { StepLog } from "@/components/hero-2/step-log";
import { gitConfig } from "@/lib/shared";

export const metadata: Metadata = {
  title: "Nyte — agent runs that outlive the process",
  description:
    "Nyte is a handwritten core for cross-platform agentic UI: immutable objects, compare-and-swapped refs, fenced leases, one ordered event stream.",
};

const source = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const nav = [
  { label: "Design", href: "/docs/design" },
  { label: "SDK", href: "/docs/sdk" },
];

/*
 * Copy on this page is lifted from the design record, not written for the
 * page. If a line here and a line there disagree, the record wins and this
 * page is wrong.
 */
const promises = [
  {
    title: "It runs anywhere.",
    body: "The same kernel runs inside an Electron main process, under a TUI, on a VM, and in request-scoped infrastructure. A runner reads all durable state at the start of each step. A long-lived process is an optimization, never a requirement.",
  },
  {
    title: "Any number of participants may write at once.",
    body: "A phone, a web page, a desktop app, and a cloud job may all submit to one session. Participant writes never take the runner's lease. They linearize through compare-and-swap and retry the conflicts they are expected to meet.",
  },
  {
    title: "Accepted input is not lost. Published history is not rewritten.",
    body: "Objects are immutable. Refs say which objects are current. A failed publish leaves a loose object, not a half-applied transaction. Retention collects an object only once nothing protects it and its grace period has passed.",
  },
];

const facts = [
  {
    fact: "The process can die at any moment, or never existed",
    mechanism: "Every uncertain tool call moves an effect ref from intent to result",
    href: "/docs/design#runs",
  },
  {
    fact: "Any process may be the one that continues a run",
    mechanism: "A runner keeps nothing in memory across a step",
    href: "/docs/design#many-runners-one-store",
  },
  {
    fact: "Writers race constantly",
    mechanism: "Multi-ref CAS, internal submission retry, and fenced runner publishes",
    href: "/docs/design#admission-is-open",
  },
  {
    fact: "The outside world will not join a database transaction",
    mechanism: "Per-effect replay policy instead of impossible exactly-once execution",
    href: "/docs/design#runs",
  },
  {
    fact: "Clients may return after retained events have expired",
    mechanism: "The event floor rejects the cursor and the client takes a snapshot",
    href: "/docs/design#events-and-views",
  },
  {
    fact: "Users change their minds",
    mechanism: "History is a tree and a head is a movable ref",
    href: "/docs/design#heads-are-named-refs",
  },
];

const gitTerms = [
  { git: "object database", core: "objects, addressed by SHA-256 of canonical JSON" },
  { git: "commit with parent", core: "conversation commit with exactly one context parent" },
  { git: "branch ref", core: "refs/heads/<head>" },
  { git: "lock file", core: "a fenced lease over refs/heads/<head>" },
  { git: "reflog", core: "retained ref events in the session stream" },
  { git: "rebase", core: "never; the model writes a summary commit instead" },
];

const packages = [
  { name: "schema", built: true },
  { name: "ai", built: true },
  { name: "core", built: true },
  { name: "ui", built: true },
  { name: "plugin", built: true },
  { name: "telemetry", built: true },
  { name: "tui", built: true },
  { name: "desktop", built: true },
  { name: "protocol", built: false },
  { name: "server", built: false },
  { name: "client", built: false },
];

const snippet = `const nyte = await createNyte({
  store: new SqliteStore(".nyte/sessions.db"),
  streamFn: (req, ctx, opts) => models.streamSimple(req, ctx, opts),
  models, model,
  landing: DEFAULT_LANDING,
  plugins: [inlinePlugin(systemPromptPlugin()), inlinePlugin(toolsFsPlugin())],
  env: { cwd },
});

const detach = nyte.attach();
const session = await nyte.sessions.create();
await nyte.messages.send({ sessionId: session.sessionId, text: "…" });`;

function Eyebrow({ index, children }: { index: string; children: string }) {
  return (
    <p className="cut-label flex items-center gap-3 text-cut-dim">
      <span className="text-cut-faint">{index}</span>
      <span>{children}</span>
    </p>
  );
}

function Section({
  index,
  label,
  children,
  className = "",
}: {
  index: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-cut-rule ${className}`}>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-16 md:px-10 md:py-28">
        <Eyebrow index={index}>{label}</Eyebrow>
        {children}
      </div>
    </section>
  );
}

export default function HeroTwo() {
  return (
    <div className="cut-page flex min-h-screen flex-col">
      {/* ---------------------------------------------------- bookend, open */}
      <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-5 py-5 md:px-10">
        <Link
          href="/hero-2"
          aria-label="Nyte, home"
          className="flex items-center gap-2.5 transition-opacity duration-150 hover:opacity-70"
        >
          <span className="text-[15px] font-semibold tracking-[-0.04em]">Nyte</span>
        </Link>

        <nav aria-label="Site" className="flex items-center gap-6 text-[0.875rem]">
          {nav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-cut-dim transition-colors duration-150 hover:text-cut-ink"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            className="border border-cut-rule-strong px-2.5 py-1 text-cut-ink transition-colors duration-150 hover:border-cut-ink"
          >
            Source
          </a>
        </nav>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative border-t border-cut-rule">
        <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 lg:grid-cols-8">
          <div className="px-5 pt-16 pb-12 md:px-10 md:pt-28 lg:col-span-4 lg:pb-28">
            <Eyebrow index="00">A handwritten core for agentic UI</Eyebrow>

            <h1 className="cut-display mt-8 text-cut-ink">
              Agent runs that <em className="font-normal text-cut-result italic">outlive</em> the
              process.
            </h1>

            <p className="mt-8 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-cut-dim">
              Objects are immutable. Refs move by compare-and-swap. Leases are fenced. A session is
              one ordered event stream. A runner reads all durable state at the start of each step,
              so any process can be the one that continues a run.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/design"
                className="inline-flex items-center bg-cut-ink px-4 py-2 text-[0.9375rem] text-cut-bg transition-colors duration-150 hover:bg-cut-result"
              >
                Read the design
              </Link>
              <Link
                href="/docs/sdk"
                className="inline-flex items-center border border-cut-rule-strong px-4 py-2 text-[0.9375rem] text-cut-ink transition-colors duration-150 hover:border-cut-ink"
              >
                createNyte
              </Link>
            </div>

            <dl className="cut-mono mt-14 grid max-w-[52ch] grid-cols-3 gap-4 border-t border-cut-rule pt-5 text-[0.75rem]">
              <div>
                <dt className="text-cut-faint">authorities</dt>
                <dd className="mt-1 text-cut-ink">4</dd>
              </div>
              <div>
                <dt className="text-cut-faint">context parents</dt>
                <dd className="mt-1 text-cut-ink">1, never 2</dd>
              </div>
              <div>
                <dt className="text-cut-faint">hosts today</dt>
                <dd className="mt-1 text-cut-ink">tui, electron</dd>
              </div>
            </dl>
          </div>

          {/* Section divider. */}
          <div
            aria-hidden="true"
            className="hidden lg:block lg:col-span-1 lg:justify-self-center lg:w-px lg:self-stretch lg:bg-cut-rule-strong"
          />

          <div className="px-5 pb-16 md:px-10 lg:col-span-3 lg:flex lg:flex-col lg:justify-center lg:pb-28 lg:pl-0">
            <StepLog />
            <p className="mt-4 text-[0.8125rem] leading-5 text-cut-faint">
              Scene two of four. A run dies between a tool intent and its result; a second runner
              takes the expired lease and replays the effect from refs.{" "}
              <Link
                href="/docs/design#what-core-is"
                className="text-cut-dim underline decoration-cut-rule-strong underline-offset-4 transition-colors hover:text-cut-ink"
              >
                All four scenes
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1280px] px-5 md:px-10">
          <Cadence />
        </div>
      </section>

      {/* -------------------------------------------------------- promises */}
      <Section index="01" label="Three promises">
        <h2 className="cut-title mt-6 max-w-[26ch]">
          Everything else on the design page is downstream of these.
        </h2>

        <ol className="mt-12 grid grid-cols-1 gap-px bg-cut-rule md:grid-cols-3">
          {promises.map((promise, i) => (
            <li key={promise.title} className="flex flex-col bg-cut-bg py-6 md:pr-8">
              <span className="cut-mono text-[0.75rem] text-cut-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-5 font-cut-serif text-[1.375rem] leading-[1.2] tracking-[-0.015em] text-cut-ink">
                {promise.title}
              </h3>
              <p className="mt-4 text-[0.9375rem] leading-[1.6] text-cut-dim">{promise.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ----------------------------------------------------------- facts */}
      <Section index="02" label="One mechanism per fact">
        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-8">
          <div className="lg:col-span-3">
            <h2 className="cut-title max-w-[22ch]">
              Each mechanism answers one fact that cannot be changed.
            </h2>
            <p className="mt-5 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-cut-dim">
              That is what keeps the count down. A new mechanism needs a new fact behind it, and
              every extra one is another thing that can disagree with the others at 3am.
            </p>
          </div>

          <ul className="divide-y divide-cut-rule border-y border-cut-rule lg:col-span-5">
            {facts.map((row) => (
              <li key={row.fact}>
                <Link
                  href={row.href}
                  className="group grid grid-cols-1 gap-2 py-4 transition-colors duration-150 sm:grid-cols-2 sm:gap-8"
                >
                  <span className="text-[0.9375rem] leading-[1.5] text-cut-ink">{row.fact}</span>
                  <span className="flex items-start gap-3 text-[0.9375rem] leading-[1.5] text-cut-dim group-hover:text-cut-ink">
                    <span
                      aria-hidden="true"
                      className="mt-[0.6em] h-px w-4 shrink-0 bg-cut-intent transition-colors group-hover:bg-cut-result"
                    />
                    {row.mechanism}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* -------------------------------------------------------- git terms */}
      <Section index="03" label="In git terms">
        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-8">
          <div className="lg:col-span-3">
            <h2 className="cut-title max-w-[22ch]">
              Git's object database, with messages in place of files.
            </h2>
            <p className="mt-5 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-cut-dim">
              If you know git, this is the reading guide. The stricter rule, and the one people push
              back on first, is one parent per commit. There is no three-way merge for two
              conversations.
            </p>
          </div>

          <dl className="cut-mono grid grid-cols-[minmax(0,10rem)_1fr] gap-x-6 gap-y-0 text-[0.8125rem] leading-5 lg:col-span-5">
            {gitTerms.map((row) => (
              <div
                key={row.git}
                className="col-span-2 grid grid-cols-subgrid border-t border-cut-rule py-3 last:border-b"
              >
                <dt className="text-cut-dim">{row.git}</dt>
                <dd className="text-cut-ink">{row.core}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* ---------------------------------------------------------- packages */}
      <Section index="04" label="Eleven names, eight directories">
        <h2 className="cut-title mt-6 max-w-[26ch]">
          The reserved rows are the most useful thing on this page.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-cut-dim">
          A browser client needs three packages that do not exist yet. They sit on the same wall so
          the front page cannot claim more than the repository does.
        </p>

        <ul className="mt-12 grid grid-cols-2 gap-px border border-cut-rule bg-cut-rule sm:grid-cols-4 lg:grid-cols-8">
          {packages.map((entry) => (
            <li
              key={entry.name}
              className={`flex aspect-[4/3] flex-col justify-between p-4 ${
                entry.built ? "bg-cut-panel" : "bg-cut-bg"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  entry.built ? "bg-cut-result" : "border border-cut-intent"
                }`}
              />
              <span className="flex flex-col gap-1">
                <span className="cut-mono text-[0.8125rem] text-cut-ink">
                  <span className="text-cut-faint">@nyte-ai/</span>
                  {entry.name}
                </span>
                <span
                  className={`cut-label ${entry.built ? "text-cut-result" : "text-cut-intent"}`}
                >
                  {entry.built ? "built" : "reserved"}
                </span>
              </span>
            </li>
          ))}
          {/* Fill the wall to a full row: 12 cells at 2 and 4 across, 16 at 8. */}
          <li className="aspect-[4/3] bg-cut-bg" aria-hidden="true" />
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="hidden aspect-[4/3] bg-cut-bg lg:block" aria-hidden="true" />
          ))}
        </ul>
      </Section>

      {/* -------------------------------------------------------------- sdk */}
      <Section index="05" label="The SDK">
        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-8">
          <div className="lg:col-span-3">
            <h2 className="cut-title max-w-[22ch]">
              A store, a stream function, a catalog, and plugins go in.
            </h2>
            <p className="mt-5 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-cut-dim">
              Verbs and one event stream come out. Send admits a message into a lane; it does not
              start a run. The host that called{" "}
              <span className="cut-mono text-cut-ink">attach()</span> is the process that volunteers
              to run.
            </p>
            <Link
              href="/docs/sdk"
              className="mt-8 inline-flex items-center border border-cut-rule-strong px-4 py-2 text-[0.9375rem] text-cut-ink transition-colors duration-150 hover:border-cut-ink"
            >
              The copy-paste path
            </Link>
          </div>

          <figure className="cut-mono overflow-hidden border border-cut-rule-strong bg-cut-panel lg:col-span-5">
            <figcaption className="flex items-center justify-between border-b border-cut-rule px-4 py-2.5">
              <span className="cut-label text-cut-dim">host.ts</span>
              <span className="cut-label text-cut-faint">@nyte-ai/core</span>
            </figcaption>
            <pre className="overflow-x-auto px-4 py-4 text-[0.8125rem] leading-[1.7] text-cut-ink">
              <code>{snippet}</code>
            </pre>
          </figure>
        </div>
      </Section>

      {/* --------------------------------------------------- bookend, close */}
      <footer className="mt-auto border-t border-cut-rule">
        <div className="mx-auto w-full max-w-[1280px] px-5 md:px-10">
          <Cadence className="rotate-180" />
        </div>
        <div className="mx-auto flex w-full max-w-[1280px] flex-row-reverse items-center justify-between px-5 py-8 md:px-10">
          <span className="flex items-center gap-2.5 text-cut-dim">
            <span className="text-[15px] font-semibold tracking-[-0.04em]">Nyte</span>
          </span>

          <nav aria-label="Footer" className="cut-mono flex items-center gap-6 text-[0.75rem]">
            <Link href="/docs/design#invariants" className="text-cut-dim hover:text-cut-ink">
              Invariants
            </Link>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer"
              className="text-cut-dim hover:text-cut-ink"
            >
              llms.txt
            </a>
            <a
              href={source}
              target="_blank"
              rel="noreferrer"
              className="text-cut-dim hover:text-cut-ink"
            >
              github
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
