/**
 * Collapsed pill ↔ focused card, and the thinking slider that grows out of the
 * gauge. Numbers come from Mehdi Davoodi's MIT ChatGPT model-selector demo
 * (iPhone 16 Pro @3x), kept as one table so the morph and the overlay stay in
 * lockstep.
 */

export const COMPOSER = {
  /** Collapsed: a 48pt row, extra inset inside the screen gutters. */
  collapsed: { inset: 16, height: 48, radius: 24, gap: 4 },
  /** Focused: a 94pt two-row card, flush with the gutters. */
  expanded: { inset: 0, height: 94, radius: 28, gap: 12 },
  hit: 34,
  sendSize: 32,
  fontSize: 17,
} as const;

export const SELECTOR = {
  trackInset: 31,
  trackHeight: 72,
  inset: 12,
  knobRing: 4,
  tickSize: 12,
  closedHeight: 34,
  closedInset: 2,
  closedRing: 2,
  /**
   * Progress below which the overlay counts as landed: it unmounts and the
   * composer takes its gauge back. Sized against remaining travel (~2pt), not
   * time, because the close spring crawls toward zero.
   */
  handoff: 0.01,
  labelSize: 22,
  labelGap: 20,
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
  close: { mass: 1, duration: 150 },
  knob: { mass: 1, stiffness: 995, damping: 53.6 },
  focus: { mass: 1, stiffness: 220, damping: 26 },
} as const;

/** Icon-row centre, measured in from a card edge — bottom and sides alike. */
export const ICON_ROW_INSET = 24;

/** The gauge's anchor from the card's right edge; Stop claims it while running. */
export const GAUGE_RIGHT = 68.5;

/** Where the gauge anchors while Stop holds its spot. */
export const GAUGE_RIGHT_RUNNING = 109;
