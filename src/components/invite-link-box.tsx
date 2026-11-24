"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

const noop = () => () => {};

/**
 * Zobrazí práve vygenerovaný link. Token je v časti za mriežkou (#), ktorú
 * prehliadač neposiela na server – nedostane sa tak do logov ani do náhľadov odkazov.
 */
export function InviteLinkBox({ token, groupName, note }: { token: string; groupName: string; note?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);
  const url = `${origin}/pozvanka#${token}`;
  const text = `Pridaj sa do partie ${groupName} v appke Matchday:`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopírovanie zlyhalo. Označ link a skopíruj ho ručne.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "Matchday", text, url });
    } catch {
      // používateľ zdieľanie zrušil
    }
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-3.5">
      <label className="eyebrow !text-primary" htmlFor="invite-url">Pozývací link</label>
      <input
        id="invite-url"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 h-11 w-full rounded-lg border border-line-strong bg-bg px-3 font-mono text-xs text-ink"
      />
      <div className="mt-2.5 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
          {copied ? "Skopírované" : "Kopírovať"}
        </Button>
        {canShare ? (
          <Button variant="secondary" className="flex-1" onClick={share} icon={<Share2 className="size-4" />}>
            Zdieľať
          </Button>
        ) : (
          <a
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-line-strong bg-elevated px-4 text-[0.9375rem] font-medium text-ink"
            href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        )}
      </div>
      <p className="mt-2.5 text-xs text-muted">
        {note ?? "Link sa zobrazí iba teraz – v databáze je uložený len jeho odtlačok. Ak ho stratíš, vygeneruj nový."}
      </p>
    </div>
  );
}
