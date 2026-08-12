import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "mistakes.party";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: "MISTAKES.PARTY — Nick makes things",
    description:
      "Nick makes XR/VR, websites, apps, video games, art, and useful mistakes.",
    openGraph: {
      type: "website",
      title: "MISTAKES.PARTY",
      description: "NICK / WEB · APPS · GAMES · ART",
      images: [{ url: socialImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MISTAKES.PARTY",
      description: "NICK / WEB · APPS · GAMES · ART",
      creator: "@iaaafm",
      images: [socialImage],
    },
  };
}

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
