"use client";

import { DialRoot, useDialKit } from "dialkit";
import "dialkit/styles.css";
import { Collaborators, type Collaborator } from "./collaborators";
import { DesktopMock, MobileMock, TuiMock } from "./host-mocks";

type Host = "desktop" | "mobile" | "tui";

const HOSTS: Host[] = ["desktop", "mobile", "tui"];

const MOCKS = {
  desktop: DesktopMock,
  mobile: MobileMock,
  tui: TuiMock,
};

const isHost = (value: string): value is Host => HOSTS.some((host) => host === value);

const range = (
  value: number,
  min: number,
  max: number,
  step?: number,
): [number, number, number, number?] => [value, min, max, step];

const slotDial = (host: Host, scale: number, x: number, y: number) => ({
  host: { type: "select" as const, options: [...HOSTS], default: host },
  scale: range(scale, 0.15, 1.2, 0.01),
  x: range(x, -240, 240, 2),
  y: range(y, -240, 240, 2),
  cursors: {
    _collapsed: true,
    x: range(0, -60, 60, 1),
    y: range(0, -60, 60, 1),
    size: range(1, 0.5, 2.4, 0.05),
    drift: range(1, 0, 3, 0.05),
  },
});

/* Who is writing into a given shell: the other two, plus the cloud. */
const WATCHERS: Record<Host, Collaborator[]> = {
  desktop: [
    { name: "phone", color: "#ed4da7", x: 42, y: 28, dx: 26, dy: 18, seconds: 13 },
    {
      name: "tui",
      color: "#07c480",
      x: 64,
      y: 58,
      dx: 20,
      dy: 24,
      seconds: 17,
      delay: -4,
      typing: true,
    },
  ],
  mobile: [
    { name: "desktop", color: "#1084fe", x: 26, y: 44, dx: 18, dy: 22, seconds: 15, typing: true },
  ],
  tui: [{ name: "cloud job", color: "#ffca00", x: 56, y: 26, dx: 22, dy: 16, seconds: 14 }],
};

interface Card {
  title: string;
  className: string;
  slot?: number;
}

const CARDS: Card[] = [
  { title: "Core", className: "bg-[#1614b8] text-white sm:col-span-2" },
  { title: "Desktop", className: "bg-white text-[var(--hero-blue)] sm:row-span-2", slot: 0 },
  { title: "Terminal", className: "bg-[#ed4da7] text-white", slot: 1 },
  { title: "Phone", className: "bg-[#a3fead] text-[#07301c]", slot: 2 },
];

export function Bento() {
  /*
   * One folder per shell: switch which app a card shows, nudge its framing,
   * and place the cursors riding on it. DialKit exports the settled values.
   */
  const dials = useDialKit("Bento", {
    desktop: slotDial("desktop", 0.3, -8, 16),
    terminal: slotDial("tui", 0.34, 0, 12),
    phone: slotDial("mobile", 0.32, 16, -8),
  });

  const slots = [dials.desktop, dials.terminal, dials.phone];

  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const slot = card.slot === undefined ? null : slots[card.slot];
          const host = slot && isHost(slot.host) ? slot.host : null;
          const Mock = host ? MOCKS[host] : null;

          return (
            <article
              key={card.title}
              className={`relative flex flex-col overflow-hidden rounded-[var(--nyte-radius-card)] p-5 ${card.className}`}
            >
              <h3 className="relative z-20 text-[1.0625rem] font-semibold tracking-[-0.02em]">
                {card.title}
              </h3>

              {slot && host && Mock ? (
                <div
                  aria-hidden="true"
                  className="relative mt-4 flex-1 select-none"
                  style={{ transform: `translate(${slot.x}px, ${slot.y}px)` }}
                >
                  <Mock scale={slot.scale} />
                  <Collaborators
                    people={WATCHERS[host]}
                    placement={{
                      x: slot.cursors.x,
                      y: slot.cursors.y,
                      scale: slot.cursors.size,
                      drift: slot.cursors.drift,
                    }}
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <DialRoot position="bottom-right" defaultOpen={false} theme="dark" />
    </div>
  );
}
