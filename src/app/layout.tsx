import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

// Písma sa pri builde stiahnu a servírujú z vlastnej domény (žiadne volania na Google).
const barlow = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Matchday", template: "%s · Matchday" },
  description: "Zápasy, dochádzka, štatistiky a pokladnica našej futbalovej partie.",
  applicationName: "Matchday",
  // Súkromná aplikácia – nemá čo robiť vo vyhľadávačoch.
  robots: { index: false, follow: false },
  // Pozývací token je v URL za mriežkou; aj tak nechceme posielať adresu ďalej.
  referrer: "no-referrer",
  appleWebApp: { capable: true, title: "Matchday", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0E0D",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
