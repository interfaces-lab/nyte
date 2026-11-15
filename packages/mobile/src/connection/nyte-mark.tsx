import { useColorScheme } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "../theme.ts";

/** The light is always the lighter of the two shapes, so the dimmed one swaps with the color scheme. */
export function NyteMark({ size }: { size: number }) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill={theme.foreground} accessible={false}>
      <Path
        d="M56.817.817A48 48 0 1 0 95.183 39.183 32 32 0 1 1 56.817.817Z"
        opacity={dark ? 0.47 : 1}
      />
      <Circle cx={64} cy={32} r={32} opacity={dark ? 1 : 0.58} />
    </Svg>
  );
}
