import "./global.css";
import { props } from "@stylexjs/stylex";
import { siteTypography } from "~/theme.stylex";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
      className={`${inter.variable} ${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable} ${props(siteTypography).className ?? ""}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-svh min-w-0 flex-col bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
