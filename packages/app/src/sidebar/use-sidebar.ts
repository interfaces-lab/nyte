import { useSetting } from "../preferences/index.ts";
import { appShape } from "../workbench/app-shape.ts";
import { windowSidebar } from "../workbench/window-sidebar.ts";

type SidebarState = "expanded" | "collapsed";

export interface SidebarControl {
  readonly state: SidebarState;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggleSidebar: () => void;
}

export function useSidebar(): SidebarControl {
  const open = useSetting(appShape().sidebar.visible);

  return {
    state: open ? "expanded" : "collapsed",
    open,
    setOpen: windowSidebar.setOpen,
    toggleSidebar: windowSidebar.toggle,
  };
}
