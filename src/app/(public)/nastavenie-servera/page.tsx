import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

export const metadata: Metadata = { title: "Chýba konfigurácia" };

// Zobrazí sa, keď aplikácia beží bez údajov o Supabase projekte.
export default function MissingConfigPage() {
  return (
    <div className="animate-rise">
      <span className="flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
        <ServerCog className="size-6" aria-hidden />
      </span>
      <h1 className="display mt-5 text-3xl text-ink">Chýba prepojenie na databázu</h1>
      <p className="mt-3 text-muted">Aplikácia nemá nastavený Supabase projekt. Doplň premenné prostredia a reštartuj server:</p>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface p-3.5 font-mono text-xs leading-relaxed text-ink">
        {"NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="}
      </pre>
      <p className="mt-3 text-sm text-muted">Presný postup je v súbore README.md, časť „Spustenie“.</p>
    </div>
  );
}
