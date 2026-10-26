import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "@tanstack/react-router";
import { IconBarsTwo, IconCrossSmall } from "central-icons";
import { HrefLink } from "~/components/site/href-link";
import { DocNav } from "~/components/site/sidebar";
import { findPage, type NavSection } from "~/lib/docs";

const subscribeToNothing = () => () => undefined;

const siteLinkClass =
  "block rounded-full px-2.5 py-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground";

/**
 * The phone menu fills the screen beneath the sticky nav, which stays on top
 * with its close control, the way a native sheet keeps its toolbar. While it
 * is open, `html[data-menu-open]` locks the page and drops the nav's
 * over-the-plate colours. It remembers the page it was opened on, so
 * navigating anywhere else closes it.
 */
export function SiteMobileNav({
  docs,
  site,
  githubHref,
}: {
  docs: readonly NavSection[];
  site: readonly NavSection[];
  githubHref: string;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const onClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toc = findPage(pathname)?.toc.filter((entry) => entry.depth === 2) ?? [];
  const close = () => setOpenedOn(null);

  return (
    <>
      <button
        ref={toggle}
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls="site-menu"
        data-open={open || undefined}
        className="group hidden size-(--site-nav-control) cursor-pointer items-center justify-center rounded-full bg-fill-selected text-foreground hover:bg-foreground/10 max-lg:inline-flex hero:text-white"
        onClick={() => setOpenedOn(open ? null : pathname)}
      >
        {open ? <IconCrossSmall size={16} /> : <IconBarsTwo size={16} />}
      </button>
      {open ? <OpenMenu panel={panel} toggle={toggle} onClose={close} /> : null}
      {onClient
        ? createPortal(
            <div
              ref={panel}
              id="site-menu"
              aria-label="Navigation"
              tabIndex={-1}
              inert={!open}
              data-open={open || undefined}
              className="site-menu lg:hidden"
            >
              <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
                <DocNav
                  className="flex flex-col gap-6 text-lg/7"
                  sections={docs}
                  toc={toc}
                  onNavigate={close}
                />
                <nav
                  className="flex flex-col gap-6 border-t border-border-subtle pt-6 text-lg/7"
                  aria-label="Site"
                >
                  {site.map((section) => (
                    <div key={section.label ?? section.items[0].href}>
                      {section.label ? (
                        <h2 className="px-2.5 pb-1 font-normal text-tertiary-foreground">
                          {section.label}
                        </h2>
                      ) : null}
                      {section.items.map((item) => (
                        <HrefLink
                          key={item.href}
                          href={item.href}
                          className={siteLinkClass}
                          onClick={close}
                        >
                          {item.title}
                        </HrefLink>
                      ))}
                    </div>
                  ))}
                  <a
                    href={githubHref}
                    target="_blank"
                    rel="noreferrer"
                    className={siteLinkClass}
                    onClick={close}
                  >
                    GitHub
                  </a>
                </nav>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Mounted while the menu is open: locks the page, focuses the panel and closes on Escape. */
function OpenMenu(props: {
  panel: RefObject<HTMLDivElement | null>;
  toggle: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  useMountEffect(() => {
    const root = document.documentElement;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      props.onClose();
      props.toggle.current?.focus();
    };

    root.dataset.menuOpen = "";
    props.panel.current?.focus();
    document.addEventListener("keydown", onKey);

    return () => {
      delete root.dataset.menuOpen;
      document.removeEventListener("keydown", onKey);
    };
  });

  return null;
}
