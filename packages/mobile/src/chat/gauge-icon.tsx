import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { GAUGE } from "./composer-geometry.ts";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const RAD = Math.PI / 180;

function polar(cx: number, cy: number, r: number, deg: number) {
  "worklet";

  return { x: cx + r * Math.sin(deg * RAD), y: cy - r * Math.cos(deg * RAD) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  "worklet";
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);

  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

export function GaugeIcon({
  level,
  stopCount,
  accent,
  track,
  needle,
  size = GAUGE.size,
}: {
  /** Continuous position along the model's stops, 0…stopCount-1. */
  level: SharedValue<number>;
  stopCount: number;
  accent: string;
  track: string;
  needle: string;
  size?: number;
}) {
  const r = (size - GAUGE.strokeWidth) / 2;
  const c = size / 2;
  const { arcStart, arcSweep, strokeWidth } = GAUGE;
  const last = Math.max(stopCount - 1, 1);
  const backdrop = arc(c, c, r, arcStart, arcStart + arcSweep);

  const fillProps = useAnimatedProps(() => {
    const f = interpolate(
      level.get(),
      [0, last],
      [GAUGE.fillStart, GAUGE.fillEnd],
      Extrapolation.CLAMP,
    );

    return { d: arc(c, c, r, arcStart, arcStart + Math.max(0.01, f) * arcSweep) };
  });

  const needleProps = useAnimatedProps(() => {
    const deg = interpolate(
      level.get(),
      [0, last],
      [GAUGE.needleStart, GAUGE.needleEnd],
      Extrapolation.CLAMP,
    );

    const base = polar(c, c, GAUGE.needleFrom, deg);
    const tip = polar(c, c, r * GAUGE.needleTo, deg);
    const px = Math.cos(deg * RAD);
    const py = Math.sin(deg * RAD);
    const b = GAUGE.needleBase;
    const t = GAUGE.needleTip;

    return {
      d:
        `M ${base.x + px * b} ${base.y + py * b} ` +
        `L ${tip.x + px * t} ${tip.y + py * t} ` +
        `L ${tip.x - px * t} ${tip.y - py * t} ` +
        `L ${base.x - px * b} ${base.y - py * b} Z`,
    };
  });

  return (
    <Svg width={size} height={size}>
      <Path
        d={backdrop}
        stroke={track}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedPath
        animatedProps={fillProps}
        stroke={accent}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedPath
        animatedProps={needleProps}
        fill={needle}
        stroke={needle}
        strokeWidth={GAUGE.needleRound}
        strokeLinejoin="round"
      />
      <Circle
        cx={c}
        cy={c}
        r={GAUGE.hubRadius}
        stroke={needle}
        strokeWidth={GAUGE.hubStroke}
        fill="none"
      />
    </Svg>
  );
}
