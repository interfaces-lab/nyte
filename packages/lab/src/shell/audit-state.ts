export type AuditSurface = "none" | "menu" | "submenu" | "context" | "popover" | "dialog";

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
