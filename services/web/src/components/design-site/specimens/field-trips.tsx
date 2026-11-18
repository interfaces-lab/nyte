import { cell, crescentPath, light, moon, tile, units } from "~/components/field-trips/geometry";

const lines = Array.from({ length: 9 }, (_, index) => index * cell);

function LogoSpecimen() {
  return (
    <svg
      viewBox={`-4 -4 ${tile + 8} ${tile + 8}`}
      width={176}
      height={176}
      aria-hidden="true"
      className="design-trip-specimen"
    >
      <path
        className="design-trip-gridline"
        d={lines.map((at) => `M ${at} 0 V ${tile} M 0 ${at} H ${tile}`).join(" ")}
      />
      <path className="design-mark-moon" d={crescentPath()} />
      <circle
        className="design-mark-light"
        cx={units(light.x)}
        cy={units(light.y)}
        r={units(light.r)}
      />
      {[moon, light].map((circle) => (
        <g key={circle.r} className="design-trip-construction">
          <circle cx={units(circle.x)} cy={units(circle.y)} r={units(circle.r)} />
          <circle cx={units(circle.x)} cy={units(circle.y)} r={1.2} data-point />
        </g>
      ))}
    </svg>
  );
}

export const fieldTripSpecimens = {
  logo: LogoSpecimen,
};
