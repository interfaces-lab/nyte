import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { PackageWall } from "~/components/landing/package-wall";
import { TwoHosts } from "~/components/landing/two-hosts";
import { landing } from "~/components/landing/landing.stylex";
import { gitConfig } from "~/lib/shared";

const source = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export default function LandingPage() {
  return (
    <>
      <section className="section">
        <div className="hero">
          <h1 className="t-display">Start in the terminal. Open the window when you want it.</h1>
          <p className="t-prose">
            We keep one session for both. The prompt you typed, the tools that ran, the answer.
          </p>
          <div className="hero-actions">
            <a href={source} target="_blank" rel="noreferrer" className="btn-solid">
              Get Nyte
            </a>
            <Link href="/docs/design" className="btn">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div {...stylex.props(landing.flexCol, landing.flexRow, landing.stage)}>
          <div {...stylex.props(landing.demo, landing.sticky)}>
            <TwoHosts />
          </div>
          <div {...stylex.props(landing.story)}>
            <div {...stylex.props(landing.beat)}>
              <h2 className="t-section">The terminal is a grid.</h2>
              <p className="t-prose">
                Your prompt is a band. The tools are rows under it. You are in a terminal.
              </p>
            </div>
            <div {...stylex.props(landing.beat)}>
              <h2 className="t-section">The window is a column.</h2>
              <p className="t-prose">
                Your prompt sits at the top of the turn. Tools and the answer share that measure.
              </p>
            </div>
            <div {...stylex.props(landing.beat)}>
              <h2 className="t-section">We draw it twice.</h2>
              <p className="t-prose">
                A tool that runs in the window runs in the terminal. There is nothing to sync.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="two">
          <div>
            <h2 className="t-section">The libraries</h2>
            <p className="t-prose">
              The apps you looked at are built from these. You can use them too.
            </p>
          </div>
          <PackageWall />
        </div>
      </section>
    </>
  );
}
