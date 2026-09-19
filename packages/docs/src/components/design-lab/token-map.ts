/**
 * The roles where the two systems actually disagree, with both values.
 *
 * Nyte's column is resolved from `theme/tokens.css` light mode: its ramp is
 * `color-mix(in srgb, var(--nyte-base) N%, transparent)` off `#141414`, so the
 * literal here is that mix written out.
 *
 * NDS's column is the shipped value from `cron-D7Buzshw.js`.
 *
 * Each row overrides one custom property on the frame, so a single toggle
 * isolates what that one decision is doing.
 */

export interface TokenRow {
  readonly id: string;
  readonly role: string;
  /** The custom property the shell reads. */
  readonly cssVar: string;
  readonly nyte: string;
  readonly nds: string;
  readonly note: string;
  readonly kind: "color" | "shadow" | "scalar";
}

export const TOKEN_ROWS: readonly TokenRow[] = [
  {
    id: "ink",
    role: "Ink",
    cssVar: "--nds-text-primary",
    nyte: "#141414",
    nds: "rgba(50,48,44,1)",
    note: "Neutral against warm. The single biggest change in feel.",
    kind: "color",
  },
  {
    id: "text-secondary",
    role: "Text secondary",
    cssVar: "--nds-text-secondary",
    nyte: "rgba(20,20,20,0.74)",
    nds: "rgba(120,119,116,1)",
    note: "Nyte dims the ink; NDS names a colour, so contrast is predictable on any surface.",
    kind: "color",
  },
  {
    id: "wash",
    role: "Pane / chrome",
    cssVar: "--nds-surface-wash",
    nyte: "#f8f8f8",
    nds: "rgba(248,248,247,1)",
    note: "Near-identical. Warmth is the only difference.",
    kind: "color",
  },
  {
    id: "sunken",
    role: "Rail",
    cssVar: "--nds-surface-sunken",
    nyte: "#ebebed",
    nds: "rgb(241,241,239)",
    note: "Derived, not shipped: gray-30 flattened over gray-50. Nyte's rail is deeper and cooler.",
    kind: "color",
  },
  {
    id: "stroke",
    role: "Hairline",
    cssVar: "--nds-stroke-secondary",
    nyte: "rgba(20,20,20,0.12)",
    nds: "rgba(84,72,49,0.08)",
    note: "Nyte's is half again as strong, and cool.",
    kind: "color",
  },
  {
    id: "hover",
    role: "State · hover",
    cssVar: "--nds-state-hover",
    nyte: "rgba(20,20,20,0.08)",
    nds: "rgba(0,0,0,0.04)",
    note: "Nyte hovers at 8%, which is heavier than its own selected step.",
    kind: "color",
  },
  {
    id: "selected",
    role: "State · selected",
    cssVar: "--nds-state-selected",
    nyte: "rgba(20,20,20,0.06)",
    nds: "rgba(0,0,0,0.06)",
    note: "Same value. Toggle hover alone to see the ordering invert.",
    kind: "color",
  },
  {
    id: "success",
    role: "Success",
    cssVar: "--nds-success",
    nyte: "#00c972",
    nds: "rgba(68,131,97,1)",
    note: "Nyte's is a signal green; NDS's is muted enough to sit in body text.",
    kind: "color",
  },
  {
    id: "danger",
    role: "Danger",
    cssVar: "--nds-danger",
    nyte: "#c21d2e",
    nds: "rgba(212,76,71,1)",
    note: "Same story: saturation that survives being next to prose.",
    kind: "color",
  },
  {
    id: "success-wash",
    role: "Diff · added",
    cssVar: "--nds-success-wash",
    nyte: "oklch(0.663 0.162 155.537 / 0.141)",
    nds: "rgba(123,183,129,0.07)",
    note: "A one-off literal in tokens.css against a step on the ramp.",
    kind: "color",
  },
  {
    id: "danger-wash",
    role: "Diff · removed",
    cssVar: "--nds-danger-wash",
    nyte: "oklch(0.703 0.192 13.697 / 0.22)",
    nds: "rgba(243,136,118,0.07)",
    note: "Nyte's removed wash is 1.56x the weight of its added wash; NDS ships both at 7%.",
    kind: "color",
  },
  {
    id: "shadow",
    role: "Elevation · lg",
    cssVar: "--nds-shadow-lg",
    nyte: "inset 0 0 4px #ffffff0d, 0 0 3px rgba(0,0,0,0.12), 0 16px 24px rgba(0,0,0,0.06)",
    nds: "0px 24px 48px -8px rgba(0,0,0,0.24), 0px 4px 12px -1px rgba(0,0,0,0.12)",
    note: "Nyte adds an even inset glow. Shown on menus, where Nyte would use its lighter popover shadow.",
    kind: "shadow",
  },
  {
    id: "weight-medium",
    role: "Weight · medium",
    cssVar: "--nds-weight-medium",
    nyte: "500",
    nds: "550",
    note: "Optical weights, available because Inter Variable ships.",
    kind: "scalar",
  },
  {
    id: "weight-semibold",
    role: "Weight · semibold",
    cssVar: "--nds-weight-semibold",
    nyte: "600",
    nds: "650",
    note: "Applies to the pane title and section headings.",
    kind: "scalar",
  },
];
