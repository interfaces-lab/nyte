import { portalSlot } from "../lib/portal-slot.ts";

const windowActions = portalSlot();

const navigator = portalSlot();

/** Where the title bar holds the main area's own controls, so the view that owns them can portal them there. */
export const attachWindowActions = windowActions.attach;

export const useWindowActionsSlot = windowActions.use;

/** Where the shell's sidebar holds a Code window's explorer, so the Editor that owns it can portal it there. */
export const attachNavigator = navigator.attach;

export const useNavigatorSlot = navigator.use;
