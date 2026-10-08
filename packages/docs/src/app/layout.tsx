import "./global.css";
import { props } from "@stylexjs/stylex";
import { siteTypography } from "~/theme.stylex";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SelectionHue } from "~/components/selection-hue";
import { appName, siteDescription, siteTitle, siteUrl } from "~/lib/shared";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : siteUrl,
  ),
  applicationName: appName,
  title: {
    default: siteTitle,
    template: `%s · ${appName}`,
  },
  description: siteDescription,
  openGraph: {
    type: "website",
    siteName: appName,
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
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
        <SelectionHue />
      </body>
    </html>
  );
}
