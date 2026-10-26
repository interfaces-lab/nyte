import { preferences, useSetting } from "../preferences/index.ts";
import { shellActions } from "./shell-state.ts";

export type SidebarState = "expanded" | "collapsed";

export interface SidebarControl {
  readonly state: SidebarState;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggleSidebar: () => void;
}

export function useSidebar(): SidebarControl {
  const open = useSetting(preferences.sidebarVisible);

  return {
    state: open ? "expanded" : "collapsed",
    open,
    setOpen: (next) => preferences.sidebarVisible.set(next),
    toggleSidebar: shellActions.toggleSidebar,
  };
}
