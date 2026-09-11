import Link from "next/link";
import { PackageWall } from "~/components/landing/package-wall";
import { TwoHosts } from "~/components/landing/two-hosts";
import { gitConfig } from "~/lib/shared";

export default function LandingPage() {
  return (
    <>
      <section className="section">
        <div className="hero">
          <h1 className="t-display">Build and run AI agents with Nyte.</h1>
          <div className="hero-actions">
            <Link href="/docs/design" className="btn-solid">
              Open the docs
            </Link>
            <a
              href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              Source
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <TwoHosts />
      </section>

      <section className="section">
        <div className="two">
          <div>
            <h2 className="t-section">What's in Nyte</h2>
            <p className="t-prose">
              Libraries for building AI agents, with terminal and desktop apps for using them.
            </p>
          </div>
          <PackageWall />
        </div>
      </section>
    </>
  );
}
