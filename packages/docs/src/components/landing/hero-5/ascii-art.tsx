export function AsciiArt({ rows, className }: { rows: readonly string[]; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${(rows[0]?.length ?? 0) * 6} ${rows.length * 10}`}
      fill="currentColor"
      className={className}
    >
      <text fontFamily="monospace" fontSize="10" fontWeight="600" xmlSpace="preserve">
        {rows.map((row, index) => (
          <tspan key={index} x="0" y={index * 10 + 8}>
            {row}
          </tspan>
        ))}
      </text>
    </svg>
  );
}
