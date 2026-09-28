import { cn } from "cn";
import Link from "next/link";

/*
 * Built rows link to the design section that covers them. The last connector is
 * dashed because @nyte-ai/protocol is named and not built. Accent means built.
 * Reserved rows stay muted, with a hollow marker.
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
    note: "the wire a browser client would attach to. Reserved, not built",
    built: false,
  },
];

export function CallPath() {
  return (
    <ol className="max-w-184 font-mono text-[13px]/none [font-variant-ligatures:none]">
      {stages.map((stage, index) => (
        <li key={stage.name} className="relative pl-7">
          {stage.hop ? (
            <span
              aria-hidden
              className={cn(
                "absolute top-[14px] bottom-0 left-[5px] w-0 border-l border-(--nyte-stroke-secondary)",
                stage.hop === "dashed" && "border-dashed",
              )}
            />
          ) : null}

          <span
            aria-hidden
            className={cn(
              "absolute top-[9px] left-[2px] size-1.5",
              stage.built
                ? "bg-(--nyte-text-accent)"
                : "border border-(--nyte-text-tertiary) bg-(--nyte-bg-page)",
            )}
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
          className={cn(
            "shrink-0",
            stage.built
              ? "text-(--nyte-text-primary) underline decoration-transparent decoration-1 underline-offset-4 transition-[text-decoration-color] duration-(--nyte-duration-fast) hover:decoration-(--nyte-text-accent)"
              : "text-(--nyte-text-tertiary)",
          )}
        >
          {stage.name}
        </span>
        <span
          aria-hidden
          className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-(--nyte-stroke-secondary)"
        />
        <span className="hidden shrink-0 text-(--nyte-text-tertiary) sm:inline">{stage.note}</span>
      </span>
      <span className="mt-2 block text-(--nyte-text-tertiary) sm:hidden">{stage.note}</span>
    </>
  );

  if (!stage.href) return <div className={padding}>{body}</div>;

  return (
    <Link href={stage.href} className={padding}>
      {body}
    </Link>
  );
}
