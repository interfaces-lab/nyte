import { useColorScheme } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "../theme.ts";

export function NyteMark({ size }: { size: number }) {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100.507 100.507"
      fill={theme.foreground}
      accessible={false}
    >
      <Path
        d="M72.423 8.931A48 48 0 1 0 95.353 58.106 32 32 0 1 1 72.423 8.931Z"
        opacity={dark ? 0.47 : 1}
      />
      <Circle cx={68.507} cy={40.691} r={32} opacity={dark ? 1 : 0.58} />
    </Svg>
  );
}
