import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mistakes.party"),
  title: "MXP — Mistakes.party",
  description:
    "A quiet index of projects, writing, games, and work by Mistakes.party.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>{children}</body>
    </html>
  );
}
