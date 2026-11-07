/**
 * How close, in points, the macOS window buttons' centre comes to the titlebar's. Both snap to whole
 * points, so half a point is as close as they get, and desktop main places the buttons from its own
 * copy of the titlebar height: a miss past this means that copy and `--nyte-titlebar-height` differ.
 */
export const WINDOW_BUTTON_CENTRE_TOLERANCE = 0.5;
