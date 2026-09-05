/*
 * Sixty-four hairline ticks. Eight of them are lit and taller, on an
 * irregular beat: the page's pulse. Nothing about the ruler is a scale a
 * reader can measure with, which is the point — steps in a run do not arrive
 * on a clock, they arrive when the previous one is durable.
 */
const BEATS = new Set([8, 17, 21, 32, 42, 46, 47, 60]);

export function Cadence({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex h-4 items-end justify-between ${className}`}>
      {Array.from({ length: 64 }, (_, i) => (
        <span
          key={i}
          className={
            BEATS.has(i)
              ? "h-4 w-px bg-cut-result"
              : i % 8 === 0
                ? "h-2.5 w-px bg-cut-rule-strong"
                : "h-1.5 w-px bg-cut-rule"
          }
        />
      ))}
    </div>
  );
}
