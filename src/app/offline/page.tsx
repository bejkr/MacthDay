import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Wordmark } from "@/components/nav";
import { ReloadButton } from "./reload-button";

export const metadata: Metadata = { title: "Offline" };

// Statická stránka, ktorú si service worker uloží pri inštalácii a ukáže ju,
// keď sa nepodarí načítať žiadnu obrazovku.
export default function OfflinePage() {
  return (
    <div className="pitch flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark className="text-2xl" />
      <span className="mt-10 flex size-16 items-center justify-center rounded-full bg-elevated text-muted">
        <WifiOff className="size-7" aria-hidden />
      </span>
      <h1 className="display mt-5 text-3xl text-ink">Si offline</h1>
      <p className="mt-3 max-w-xs text-muted">
        Matchday potrebuje pripojenie, aby ukázal aktuálne termíny a výsledky. Tvoje prihlásenie ostáva uložené – po pripojení pokračuješ tam, kde si skončil.
      </p>
      <ReloadButton />
    </div>
  );
}
