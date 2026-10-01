"use client";

import { shadow } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

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
    <a
      href={feature.href}
      className="flex items-center gap-2.5 rounded-xl p-2 hover:bg-foreground/5"
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center text-foreground">
        <FeatureGlyph icon={feature.icon} />
      </span>
      <span className="min-w-0 text-sm/5 font-medium text-foreground">{feature.title}</span>
    </a>
  );
}

const itemClass =
  "relative inline-flex h-(--site-nav-control) items-center rounded-full px-2.5 text-[15px] font-medium text-foreground hero:text-white";

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
    <nav
      ref={list}
      aria-label="Site"
      className="relative flex items-center gap-0.5 justify-self-start max-lg:hidden"
      onMouseLeave={close}
      onBlur={close}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 h-(--site-nav-control) rounded-full bg-current/10 opacity-0 [transition:transform_520ms_var(--ease-nav),width_520ms_var(--ease-nav),opacity_220ms_ease] data-on:opacity-100 motion-reduce:transition-none"
          data-on={active ? "" : undefined}
          style={{ transform: `translateX(${indicator.x}px)`, width: indicator.width }}
        />
      ) : null}

      {SITE_SECTIONS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className={itemClass}
          data-open={active === item.id ? "" : undefined}
          onMouseEnter={(event) => open(item.id, event.currentTarget)}
          onFocus={(event) => open(item.id, event.currentTarget)}
        >
          {item.label}
        </a>
      ))}

      <a href={githubHref} target="_blank" rel="noreferrer" className={itemClass}>
        GitHub
      </a>

      {section ? (
        <div
          className="absolute top-full left-0 z-31 w-max max-w-[min(316px,calc(100vw-48px))] animate-nav-panel-in pt-(--site-nav-pad) transition-transform duration-520 ease-nav motion-reduce:animate-none motion-reduce:transition-none"
          style={{ transform: `translateX(${indicator?.x ?? 0}px)` }}
        >
          <div
            key={section.id}
            data-direction={direction}
            {...props(styles.panel)}
            className="w-79 max-w-full animate-nav-panel-content-in rounded-2xl border border-border-subtle bg-popover p-1 text-foreground data-[direction=-1]:[--enter-x:-24px] data-[direction=1]:[--enter-x:24px] motion-reduce:animate-none"
          >
            {section.features.map((feature, i) => (
              <div
                key={feature.href}
                className="animate-nav-panel-row-in motion-reduce:animate-none"
                style={{ animationDelay: `${i * 55}ms` }}
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

const styles = create({ panel: { boxShadow: shadow.shadowLg } });
