import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Absolute URLs throughout (not metadataBase + relative paths) -- this app
// runs behind next.config.ts's basePath ("/study-tracker") AND is reachable
// at two different origins (the raw Vercel URL and the tools.mdostal.com
// multi-zone mount); hardcoding the canonical public URL here sidesteps any
// ambiguity in how those two mechanisms would otherwise combine, matching
// the same explicit-absolute-URL approach already used in docs/index.html's
// (GitHub Pages) OG tags.
const SITE_URL = "https://tools.mdostal.com/study-tracker";
const TITLE = "Medical Study Tracker";
const DESCRIPTION =
  "Ranks paid clinical-trial studies by net cash kept, cash velocity, and downtime.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: TITLE,
    type: "website",
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1440,
        height: 1024,
        alt: "Medical Study Tracker ranked table showing real paid clinical-trial studies sorted by net cash kept, cash velocity, and downtime rate",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/og-image.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SiteNav />
          {children}
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
