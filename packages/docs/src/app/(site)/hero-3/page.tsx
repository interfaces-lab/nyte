import { Button } from "@nyte-ai/ui";
import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { Bento } from "~/components/hero-3/bento";
import { FrostedWord } from "~/components/hero-3/frosted-word";
import { cta, layout } from "~/components/hero-3/hero.stylex";

export const metadata: Metadata = {
  title: "Nyte — agent, deploy anywhere",
  description:
    "One handwritten core for agentic UI. The same kernel runs in a desktop app, a terminal, and request-scoped infrastructure.",
};

export default function HeroThree() {
  return (
    <div className="hero-plate bg-[var(--hero-blue)] text-white">
      {/* Words and shells share one screen: the grid is the hero, not a section under it. */}
      <section {...stylex.props(layout.section)}>
        <div {...stylex.props(layout.copy)}>
          <h1 className="font-cut-sans text-[clamp(2.25rem,4.2vw,3.75rem)] leading-[0.98] font-medium tracking-[-0.04em]">
            Agent, deploy <FrostedWord>anywhere.</FrostedWord>
          </h1>

          <div {...stylex.props(layout.actions)}>
            <Button
              nativeButton={false}
              role="link"
              render={<Link href="/docs/sdk" />}
              xstyle={[cta.base, cta.solid]}
            >
              createNyte
            </Button>
            <Button
              nativeButton={false}
              role="link"
              variant="ghost"
              render={<Link href="/docs/design" />}
              xstyle={[cta.base, cta.quiet]}
            >
              Read the design
            </Button>
          </div>
        </div>

        <div {...stylex.props(layout.grid)}>
          <Bento />
        </div>
      </section>
    </div>
  );
}
