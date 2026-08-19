import type { Metadata, Viewport } from "next";
import "./globals.css";

const ambientColorPhaseScript = `
(() => {
  const key = "mxp:ambient-color-phase";
  const duration = 260000;

  try {
    const stored = Number(localStorage.getItem(key));
    const initialPhase = Number.isFinite(stored)
      ? ((stored % duration) + duration) % duration
      : 0;
    const startedAt = performance.now();

    document.documentElement.style.setProperty(
      "--portal-color-delay",
      "-" + initialPhase + "ms",
    );

    const savePhase = () => {
      const phase = (initialPhase + performance.now() - startedAt) % duration;
      localStorage.setItem(key, String(phase));
    };

    addEventListener("pagehide", savePhase, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") savePhase();
    });
  } catch {
    // Storage may be unavailable; the CSS animation still works from yellow.
  }
})();
`;

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
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: ambientColorPhaseScript }}
          id="ambient-color-phase"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
