export type AuditSurface = "none" | "menu" | "submenu" | "context" | "popover" | "dialog";

/*
 * The workbench has three chrome states and the audit only holds if all three
 * are reachable: the named rail, the collapsed icon rail, and an open panel.
 * Their widths, insets and shadow are separate tokens, and a dial that moves
 * one of them has nothing to say while the other two are off screen.
 */
export type WorkbenchState = "rail" | "compact" | "panel";

export function workbenchState(value: string | undefined): WorkbenchState {
  return value === "compact" || value === "panel" ? value : "rail";
}

export function auditSurface(value: string | undefined): AuditSurface {
  switch (value) {
    case "menu":
    case "submenu":
    case "context":
    case "popover":
    case "dialog":
      return value;
    default:
      return "none";
  }
}
