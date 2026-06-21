import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Klai — UI que se genera sola",
  description:
    "Extensión para Chrome que convierte tus preguntas en widgets animados sobre cualquier video. Fútbol, series, música — en tiempo real.",
  openGraph: {
    title: "Klai — UI que se genera sola",
    description:
      "Hablas. La interfaz se construye sola. Klai genera widgets animados sobre cualquier video en tiempo real.",
    url: "https://klai.pro",
    siteName: "Klai",
    locale: "es_MX",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@200,300,400,500,600,700&f[]=satoshi@300,400,500,700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
