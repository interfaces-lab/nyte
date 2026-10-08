export const COMPOSER = {
  height: 48,
  hit: 44,
  fontSize: 17,
} as const;

export const SELECTOR = {
  trackHeight: 72,
  inset: 12,
  tickSize: 12,
} as const;

export const GAUGE = {
  size: 25,
  strokeWidth: 2.5,
  arcStart: -125,
  arcSweep: 250,
  needleFrom: 1.4,
  needleTo: 0.66,
  needleBase: 0.65,
  needleTip: 0.3,
  needleRound: 1,
  hubRadius: 1.9,
  hubStroke: 1.9,
  needleStart: -52,
  needleEnd: 115,
  fillStart: 0.06,
  fillEnd: 1,
} as const;

export const SPRING = {
  open: { mass: 1, duration: 450 },
  knob: { mass: 1, stiffness: 995, damping: 53.6, overshootClamping: true },
} as const;

export const ICON_ROW_INSET = COMPOSER.height / 2;
