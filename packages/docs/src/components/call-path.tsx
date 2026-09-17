import Link from "next/link";

/*
 * The call path, drawn the way the docs already draw it — a vertical stack with
 * dotted leaders. It is the site's signature element because it is Nyte's own
 * artefact, and it does a job: built rows link to the design section that covers
 * them, and the last hop is dashed because the wire is named and unwritten.
 *
 * Colour carries state here. Meadow means built. Reserved rows get graphite and
 * a hollow marker, and never the accent.
 */

interface Stage {
  name: string;
  note: string;
  href?: string;
  built: boolean;
  /** The connector drawn beneath this row. */
  hop?: "solid" | "dashed";
}

const stages: Stage[] = [
  {
    name: "client",
    note: "tui (OpenTUI) · desktop (Electron)",
    href: "/docs/design#deployment",
    built: true,
    hop: "solid",
  },
  {
    name: "step",
    note: "one durable step under a fenced lease; drive loops it",
    href: "/docs/design#leases-and-the-step",
    built: true,
    hop: "solid",
  },
  {
    name: "turn",
    note: "respond, then the tool batch; the step commits between",
    href: "/docs/design#the-turn",
    built: true,
    hop: "solid",
  },
  {
    name: "StreamFn",
    note: "one injected function; the loop knows no provider",
    href: "/docs/design#the-sdk",
    built: true,
    hop: "solid",
  },
  {
    name: "@nyte-ai/ai",
    note: "credential store, OAuth, streamed Responses client",
    built: true,
    hop: "dashed",
  },
  {
    name: "@nyte-ai/protocol",
    note: "the wire a browser client would attach to — reserved, not built",
    built: false,
  },
];

export function SeamDiagram() {
  return (
    <ol className="nyte-mono max-w-184 text-[13px] leading-none">
      {stages.map((stage, index) => (
        <li key={stage.name} className="relative pl-7">
          {stage.hop ? (
            <span
              aria-hidden
              className={`absolute left-[5px] top-[14px] bottom-0 w-0 border-l ${
                stage.hop === "dashed" ? "border-dashed" : "border-solid"
              } border-nyte-muted/30`}
            />
          ) : null}

          <span
            aria-hidden
            className={`absolute left-[2px] top-[9px] size-1.5 ${
              stage.built ? "bg-nyte-signal" : "border border-nyte-muted bg-nyte-paper"
            }`}
          />

          <StageRow stage={stage} isLast={index === stages.length - 1} />
        </li>
      ))}
    </ol>
  );
}

function StageRow({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  const padding = isLast ? "block py-2.5" : "block py-2.5 pb-7";

  const body = (
    <>
      <span className="flex items-baseline gap-3">
        <span
          className={`shrink-0 ${
            stage.built
              ? "text-nyte-ink underline decoration-transparent decoration-1 underline-offset-4 transition-[text-decoration-color] duration-150 group-hover:decoration-nyte-signal"
              : "text-nyte-muted"
          }`}
        >
          {stage.name}
        </span>
        <span
          aria-hidden
          className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-nyte-muted/35"
        />
        <span className="hidden shrink-0 text-nyte-muted sm:inline">{stage.note}</span>
      </span>
      <span className="mt-2 block text-nyte-muted sm:hidden">{stage.note}</span>
    </>
  );

  if (!stage.href) return <div className={padding}>{body}</div>;

  return (
    <Link href={stage.href} className={`group rounded-sm ${padding}`}>
      {body}
    </Link>
  );
}
