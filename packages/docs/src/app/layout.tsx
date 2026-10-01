import "./global.css";
import { props } from "@stylexjs/stylex";
import { siteTypography } from "~/theme.stylex";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";

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
      className={`${inter.variable} ${geist.variable} ${geistMono.variable} ${props(siteTypography).className ?? ""} overflow-hidden`}
      suppressHydrationWarning
    >
      <body className="flex h-dvh min-h-svh min-w-0 flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
