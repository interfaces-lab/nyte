export const COMPOSER = {
  height: 48,
  hit: 44,
  fontSize: 17,
} as const;

export const SPRING = {
  open: { mass: 1, duration: 450 },
  knob: { mass: 1, stiffness: 995, damping: 53.6, overshootClamping: true },
} as const;

export const ICON_ROW_INSET = COMPOSER.height / 2;
