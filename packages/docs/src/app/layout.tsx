import "./global.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Newsreader } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/*
 * Geist sets the marketing statement voice: a Swiss grotesque with a
 * single-storey g and flat terminals, run at regular weight so hierarchy comes
 * from scale and spacing rather than from bold. The docs chrome stays on Inter.
 */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/*
 * Newsreader sets marketing prose on /. The editorial pattern is
 * restrained sans headings over serif paragraphs. The docs chrome never uses it.
 */
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "Nyte — a handwritten core for agentic UI",
    template: "%s — Nyte",
  },
  description:
    "Nyte is an independent, handwritten core for building cross-platform agentic UI: a durable kernel plus a standalone agent loop.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geist.variable} ${geistMono.variable} ${newsreader.variable} ${inter.className}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
