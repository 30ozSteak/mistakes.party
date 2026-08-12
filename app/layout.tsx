import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Analytics } from "@vercel/analytics/next";
import { DrawingPlayground } from "./components/DrawingPlayground";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mistakes.party"),
  title: "MXP — Mistakes.party",
  description:
    "Websites, apps, XR, games, art, and the occasional useful mistake.",
  openGraph: {
    type: "website",
    title: "MXP — Mistakes.party",
    description: "WEB · APPS · XR · GAMES · ART · USEFUL MISTAKES",
    images: [{ url: "/og-mxp.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MXP — Mistakes.party",
    description: "WEB · APPS · XR · GAMES · ART · USEFUL MISTAKES",
    creator: "@iaaafm",
    images: ["/og-mxp.png"],
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
    <html lang="en">
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
        <DrawingPlayground />
        <div className="site-surface">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
