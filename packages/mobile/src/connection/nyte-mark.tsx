import Svg, { Path } from "react-native-svg";
import { useTheme } from "../theme.ts";

const paths = createMoonPaths();

function createMoonPaths() {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

  const cells = 12;

  const pitch = 3;

  const radius = cells / 2;

  let lit = "";

  let shadow = "";

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const nx = (x + 0.5 - radius) / radius;
      const ny = (y + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;

      if (depth <= 0) continue;

      const shade = -0.62 * nx - 0.5 * ny + 0.6 * Math.sqrt(depth);
      const square = `M${x * pitch} ${y * pitch}h2v2h-2z`;

      if (shade * 16 > bayer[(y % 4) * 4 + (x % 4)] + 0.5) lit += square;
      else shadow += square;
    }
  }

  return { lit, shadow };
}

export function NyteMark({ size }: { size: number }) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" fill={theme.foreground} accessible={false}>
      <Path d={paths.shadow} opacity={0.22} />
      <Path d={paths.lit} />
    </Svg>
  );
}
