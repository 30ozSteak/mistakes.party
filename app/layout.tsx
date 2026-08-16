import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Analytics } from "@vercel/analytics/next";
import { BalloonGuestbook } from "./components/BalloonGuestbook";
import { PartyHouseProvider } from "./components/PartyHouse";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mistakes.party"),
  title: "MXP — Mistakes.party",
  description:
    "An expandable index of public code, recent writing, and games by Mistakes.party.",
  openGraph: {
    type: "website",
    title: "MXP — Mistakes.party",
    description: "Code · Writing · Games · Support",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Mistakes.party external index",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MXP — Mistakes.party",
    description: "Code · Writing · Games · Support",
    creator: "@iaaafm",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f1e9",
  colorScheme: "light",
};

// All pages are intentionally request-rendered for the per-response CSP nonce.
// Bound unexpected work rather than inheriting the platform's longer default.
export const maxDuration = 10;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A fresh CSP nonce must be generated and applied for every HTML response.
  // Data fetches may still use their own Next.js revalidation caches.
  await connection();

  return (
    <html data-scroll-behavior="smooth" lang="en">
      <head>
        <link
          as="font"
          crossOrigin="anonymous"
          href="/fonts/kill-the-noise.otf"
          rel="preload"
          type="font/otf"
        />
      </head>
      <body>
        <PartyHouseProvider>
          {children}
          <BalloonGuestbook />
        </PartyHouseProvider>
        <Analytics mode="production" />
      </body>
    </html>
  );
}
