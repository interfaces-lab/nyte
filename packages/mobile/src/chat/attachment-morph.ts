import type { ViewStyle } from "react-native";
import {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { COMPOSER, ICON_ROW_INSET } from "./composer-geometry.ts";
import { controls, menu, spacing } from "../theme.ts";

export const ATTACHMENT_MENU = {
  originSize: controls.touchTarget + menu.padding * 2,
  expandedRadius: 35,
  expandedMargin: spacing.sm,
} as const;

export function useAttachmentMorph({
  progress,
  extend,
  cardDock,
  plusLeft,
  menuWidth,
  menuHeight,
  screenWidth,
  screenHeight,
  bottomInset,
}: {
  progress: SharedValue<number>;
  extend: SharedValue<number>;
  cardDock: SharedValue<number>;
  plusLeft: SharedValue<number>;
  menuWidth: number;
  menuHeight: number;
  screenWidth: number;
  screenHeight: number;
  bottomInset: number;
}) {
  const expandedWidth = screenWidth - ATTACHMENT_MENU.expandedMargin * 2;
  const expandedHeight = Math.min(560, screenHeight - bottomInset / 2 - 120);

  const geometry = useDerivedValue(() => {
    const amount = progress.get();

    const openWidth = interpolate(amount, [0, 1], [ATTACHMENT_MENU.originSize, menuWidth]);

    const openHeight = interpolate(amount, [0, 1], [ATTACHMENT_MENU.originSize, menuHeight]);

    const openRadius = interpolate(amount, [0, 1], [ATTACHMENT_MENU.originSize / 2, menu.radius]);

    const originBottom = cardDock.get() + ICON_ROW_INSET - ATTACHMENT_MENU.originSize / 2;
    const expanded = extend.get();

    return {
      width: interpolate(expanded, [0, 1], [openWidth, expandedWidth]),
      height: interpolate(expanded, [0, 1], [openHeight, expandedHeight]),
      radius: interpolate(expanded, [0, 1], [openRadius, ATTACHMENT_MENU.expandedRadius]),
      bottom: originBottom,
      left: plusLeft.get() + (COMPOSER.hit - ATTACHMENT_MENU.originSize) / 2,
      translateX: interpolate(
        expanded,
        [0, 1],
        [
          0,
          ATTACHMENT_MENU.expandedMargin -
            plusLeft.get() -
            (COMPOSER.hit - ATTACHMENT_MENU.originSize) / 2,
        ],
      ),
      translateY: interpolate(expanded, [0, 1], [0, originBottom - ATTACHMENT_MENU.expandedMargin]),
    };
  });

  const containerStyle = useAnimatedStyle<ViewStyle>(() => ({
    width: geometry.get().width,
    height: geometry.get().height,
    borderRadius: geometry.get().radius,
    bottom: geometry.get().bottom,
    left: geometry.get().left,
    transform: [
      { translateX: geometry.get().translateX },
      { translateY: geometry.get().translateY },
    ],
  }));

  const surfaceFrame = useDerivedValue(() => {
    const current = geometry.get();

    return {
      x: current.left + current.translateX,
      y: screenHeight - current.bottom - current.height + current.translateY,
      width: current.width,
      height: current.height,
    };
  });

  const menuStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(progress.get(), [0.1, 0.45], [0, 1], Extrapolation.CLAMP) *
      interpolate(extend.get(), [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(extend.get(), [0.25, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(extend.get(), [0.5, 1], [0.98, 1], Extrapolation.CLAMP) }],
  }));

  const height = useDerivedValue(() => geometry.get().height);
  const radiusStyle = useAnimatedStyle(() => ({ borderRadius: geometry.get().radius }));

  return { containerStyle, menuStyle, panelStyle, height, radiusStyle, surfaceFrame };
}
