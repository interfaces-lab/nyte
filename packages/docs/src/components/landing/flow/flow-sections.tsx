import { IconArrowRight } from "central-icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { DelegationScene } from "./delegation-scene";
import { InboxScene } from "./inbox-scene";
import { TakeoverScene } from "./takeover-scene";

interface FlowSectionProps {
  id: string;
  /** The kernel concept, linked to its docs page. */
  topic: { label: string; href: string };
  title: string;
  body: string;
  scene: ReactNode;
}

function FlowSection({ id, topic, title, body, scene }: FlowSectionProps) {
  return (
    <section
      aria-labelledby={id}
      className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
        <div className="min-w-0">
          <Link
            href={topic.href}
            className="inline-flex items-center gap-1 font-mono text-[13px]/5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {topic.label}
            <IconArrowRight size={12} />
          </Link>
          <h2
            id={id}
            className="mt-2 max-w-[18ch] font-display text-[clamp(1.75rem,1.1rem+1.9vw,2.75rem)]/[1.05] font-medium tracking-[-0.035em] text-balance"
          >
            {title}
          </h2>
        </div>
        <p className="min-w-0 text-[16px]/7 text-pretty text-muted-foreground lg:max-w-[26rem] lg:pb-1">
          {body}
        </p>
      </div>

      <div className="mt-8">{scene}</div>
    </section>
  );
}

/*
 * How work flows through one session at once: the inbox, the lease, and
 * delegation. Each claim traces to packages/core/src/kernel/README.md.
 */
export function FlowSections() {
  return (
    <>
      <FlowSection
        id="flow-inbox"
        topic={{ label: "inbox", href: "/docs/kernel/inbox" }}
        title="Keep typing while it works."
        body="Messages sent mid-run wait in one of two queues. Steer lands at the next response boundary; next waits until the run is idle."
        scene={<InboxScene />}
      />
      <FlowSection
        id="flow-leases"
        topic={{ label: "leases", href: "/docs/kernel/step" }}
        title="Any host can take the next step."
        body="Each step reads the refs, does one thing and publishes. Nothing stays in memory between steps, so another host on the same store can take over."
        scene={<TakeoverScene />}
      />
      <FlowSection
        id="flow-delegation"
        topic={{ label: "delegation", href: "/docs/kernel/agents" }}
        title="Agents that work side by side."
        body="Each child agent is its own session. The parent can wait for any or all of them, and picks up each report when it finishes."
        scene={<DelegationScene />}
      />
    </>
  );
}
