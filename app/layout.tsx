import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mistakes.party"),
  title: "STEAKS — Web, apps, games + art",
  description:
    "STEAKS makes XR/VR, websites, apps, video games, art, and useful mistakes.",
  openGraph: {
    type: "website",
    title: "STEAKS",
    description: "WEB · APPS · GAMES · ART",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "STEAKS",
    description: "WEB · APPS · GAMES · ART",
    creator: "@iaaafm",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f1e9",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
