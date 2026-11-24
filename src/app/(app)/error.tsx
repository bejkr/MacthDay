"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-surface px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="display mt-5 text-2xl text-ink">{offline ? "Si offline" : "Nepodarilo sa načítať údaje"}</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">
        {offline
          ? "Táto obrazovka potrebuje pripojenie. Skús to znova, keď budeš online."
          : "Server neodpovedal podľa očakávania. Tvoje údaje sú v poriadku – skús stránku načítať znova."}
      </p>
      <Button className="mt-6" onClick={reset} icon={<RefreshCw className="size-4" />}>
        Skúsiť znova
      </Button>
      {error.digest ? <p className="mt-4 font-mono text-[0.6875rem] text-muted/60">kód chyby: {error.digest}</p> : null}
    </div>
  );
}
