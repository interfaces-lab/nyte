/**
 * A made-up account. Nothing on the profile page reads a real session, so
 * every name, address and identifier here is invented.
 */
import type { Tint } from "@nyte-ai/ui/surface-theme";

export type IsoDate = `${number}-${number}-${number}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date: IsoDate): string {
  const [year, month, day] = date.split("-");

  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

export const HOLDER = {
  givenName: "Mira",
  surname: "Halden",
  handle: "mira",
  email: "mira@example.com",
  accountId: "usr_7Q4K2M9XHD31",
  registeredAt: "2024-03-14",
  plan: "Pro",
  timeZone: "Europe/Berlin",
} as const satisfies Readonly<Record<string, string>> & { readonly registeredAt: IsoDate };

export interface Stamp {
  readonly title: string;
  readonly caption: string;
  readonly date: IsoDate;
  readonly frame: "ring" | "plate" | "oval";
  readonly tint: Tint;
  readonly tilt: number;
  /** Where the officer's hand landed, in px from the centre of its cell. */
  readonly offset: readonly [number, number];
}

/** Ordered by date. The first entry is the registration itself. */
export const STAMPS = [
  {
    title: "Nyte",
    caption: "Registered",
    date: "2024-03-14",
    frame: "ring",
    tint: "blue",
    tilt: -7,
    offset: [-6, 4],
  },
  {
    title: "Desktop",
    caption: "First sign-in",
    date: "2024-03-14",
    frame: "plate",
    tint: "gray",
    tilt: 4,
    offset: [4, -2],
  },
  {
    title: "First merge",
    caption: "nyte/console #12",
    date: "2024-03-19",
    frame: "oval",
    tint: "green",
    tilt: -3,
    offset: [10, -6],
  },
  {
    title: "Terminal",
    caption: "First sign-in",
    date: "2024-04-02",
    frame: "plate",
    tint: "purple",
    tilt: 6,
    offset: [-2, 6],
  },
  {
    title: "iPhone",
    caption: "First sign-in",
    date: "2024-09-21",
    frame: "plate",
    tint: "orange",
    tilt: -5,
    offset: [-4, 2],
  },
  {
    title: "1,000",
    caption: "Sessions",
    date: "2025-06-08",
    frame: "ring",
    tint: "red",
    tilt: 3,
    offset: [2, -4],
  },
] as const satisfies readonly Stamp[];

export const TOTALS = [
  { label: "Sessions", value: 1284 },
  { label: "Projects", value: 17 },
  { label: "Merged", value: 96 },
] as const;
