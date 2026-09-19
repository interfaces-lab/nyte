"use client";

import { IconBookSimple, IconLayersThree } from "central-icons";
import { useCallback, useRef, useState } from "react";
import { SITE_SECTIONS, type SiteFeature, type SiteFeatureIcon } from "~/lib/site-sections";

interface Props {
  githubHref: string;
}

function FeatureGlyph({ icon }: { icon: SiteFeatureIcon }) {
  switch (icon) {
    case "design":
      return <IconBookSimple size={18} />;
    case "cloud":
      return <IconLayersThree size={18} />;
  }
}

function Feature({ feature }: { feature: SiteFeature }) {
  return (
    <a href={feature.href} className="site-feature">
      <span className="site-feature-icon">
        <FeatureGlyph icon={feature.icon} />
      </span>
      <span className="site-feature-title">{feature.title}</span>
    </a>
  );
}

interface Indicator {
  x: number;
  width: number;
}

/*
 * Mega-menu behaviour: one panel for the whole bar, not one per trigger. It
 * slides to sit under whichever item is hovered, its contents enter from the
 * side you came from, and rows stagger in behind them. Closing is faster than
 * opening, so leaving never feels sticky.
 */
export function SiteNavSections({ githubHref }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [direction, setDirection] = useState(0);
  const [indicator, setIndicator] = useState<Indicator | null>(null);

  const open = useCallback(
    (id: string, trigger: HTMLElement) => {
      const from = SITE_SECTIONS.findIndex((section) => section.id === active);
      const to = SITE_SECTIONS.findIndex((section) => section.id === id);
      setDirection(active && active !== id ? Math.sign(to - from) : 0);
      setActive(id);

      const bounds = list.current?.getBoundingClientRect();
      const box = trigger.getBoundingClientRect();
      if (bounds) setIndicator({ x: box.left - bounds.left, width: box.width });
    },
    [active],
  );

  const close = useCallback(() => {
    setDirection(0);
    setActive(null);
  }, []);

  const section = SITE_SECTIONS.find((item) => item.id === active);

  return (
    <nav ref={list} aria-label="Site" className="site-sections" onMouseLeave={close} onBlur={close}>
      {indicator ? (
        <span
          aria-hidden="true"
          className="site-indicator"
          data-on={active ? "" : undefined}
          style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width }}
        />
      ) : null}

      {SITE_SECTIONS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className="site-sections-item"
          data-open={active === item.id ? "" : undefined}
          onMouseEnter={(event) => open(item.id, event.currentTarget)}
          onFocus={(event) => open(item.id, event.currentTarget)}
        >
          {item.label}
        </a>
      ))}

      <a href={githubHref} target="_blank" rel="noreferrer" className="site-sections-item">
        GitHub
      </a>

      {section ? (
        <div className="site-panel" style={{ transform: `translateX(${indicator?.x ?? 0}px)` }}>
          <div
            key={section.id}
            className="site-panel-card"
            style={{ ["--enter-x" as string]: `${direction * 24}px` }}
          >
            {section.features.map((feature, i) => (
              <div
                key={feature.href}
                className="site-panel-row"
                style={{ ["--enter-delay" as string]: `${i * 55}ms` }}
              >
                <Feature feature={feature} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
