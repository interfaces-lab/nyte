export type HostWindow = number;

/** How a window's page ended: a reload or navigation, a renderer crash, or the window closing. */
export type WindowEnd = "navigated" | "crashed" | "closed";
