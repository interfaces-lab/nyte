/*
 * Other people's pointers, drifting over a mock. Same session, different
 * shell: the desktop card shows the phone and the terminal writing into it,
 * and so on. Pure CSS, so every cursor on the page drifts in parallel with
 * no script running.
 */
export interface Collaborator {
  name: string;
  color: string;
  /** Position within the mock, in percent. */
  x: number;
  y: number;
  /** Drift amplitude in px, and the loop length. */
  dx: number;
  dy: number;
  seconds: number;
  delay?: number;
  typing?: boolean;
}

const ARROW =
  "M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.47a.5.5 0 0 0-.44.74Z";

export interface CursorPlacement {
  /** Nudge every cursor on this mock, in percent of the mock box. */
  x: number;
  y: number;
  scale: number;
  drift: number;
}

export function Collaborators({
  people,
  placement,
}: {
  people: Collaborator[];
  placement: CursorPlacement;
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      {people.map((person) => (
        <div
          key={person.name}
          className="mock-cursor absolute"
          style={{
            left: `${person.x + placement.x}%`,
            top: `${person.y + placement.y}%`,
            ["--dx" as string]: `${person.dx * placement.drift}px`,
            ["--dy" as string]: `${person.dy * placement.drift}px`,
            animationDuration: `${person.seconds}s`,
            animationDelay: `${person.delay ?? 0}s`,
          }}
        >
          <div
            style={{ transform: `scale(${placement.scale})`, transformOrigin: "top left" }}
            className="relative"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.28))" }}
            >
              <path
                d={ARROW}
                fill={person.color}
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>

            <span
              className="absolute top-[15px] left-[14px] flex items-center gap-1 rounded-[var(--nyte-radius-pill)] rounded-tl-[3px] px-[7px] py-[2px] text-[10px] leading-[1.35] font-semibold tracking-[-0.01em] whitespace-nowrap text-white"
              style={{
                background: person.color,
                boxShadow: "0 2px 6px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.22)",
              }}
            >
              {person.name}
              {person.typing ? <i className="mock-cursor-typing" /> : null}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
