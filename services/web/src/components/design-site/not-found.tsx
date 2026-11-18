import { Link } from "@tanstack/react-router";
import { designRoute } from "~/lib/shared";
import { DesignMain } from "./shell";

export function DesignNotFound() {
  return (
    <DesignMain>
      <section className="design-hero" aria-labelledby="design-missing">
        <h1 id="design-missing" className="design-hero-title">
          <span>404</span>
        </h1>
        <div className="design-hero-text">
          <p className="design-hero-lede">This page moved or never existed.</p>
          <Link to={designRoute} className="design-hero-link">
            Back to the index
          </Link>
        </div>
      </section>
    </DesignMain>
  );
}
