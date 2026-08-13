import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Analytics } from "@vercel/analytics/next";
import { PartyPresence } from "./components/PartyPresence";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mistakes.party"),
  title: "MXP — Mistakes.party",
  description:
    "Mistakes.party on GitHub, Medium, Patreon, and itch.io.",
  openGraph: {
    type: "website",
    title: "MXP — Mistakes.party",
    description: "GitHub · Medium · Patreon · itch.io",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Mistakes.party link portal",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MXP — Mistakes.party",
    description: "GitHub · Medium · Patreon · itch.io",
    creator: "@iaaafm",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f1e9",
  colorScheme: "light",
};

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
        <PartyPresence />
        {children}
        <Analytics mode="production" />
      </body>
    </html>
  );
}
