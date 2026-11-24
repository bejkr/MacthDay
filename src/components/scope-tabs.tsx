import Link from "next/link";
import { cn } from "@/lib/format";

export type Scope = "sezona" | "vsetko";

export const parseScope = (value: string | undefined): Scope => (value === "vsetko" ? "vsetko" : "sezona");

/** Prepínač Aktuálna sezóna / Všetky sezóny. Stav je v URL, takže sa dá zdieľať aj vrátiť späť. */
export function ScopeTabs({ basePath, scope, seasonName }: { basePath: string; scope: Scope; seasonName: string | null }) {
  const tabs: { value: Scope; label: string; href: string }[] = [
    { value: "sezona", label: seasonName ? `Sezóna ${seasonName}` : "Aktuálna sezóna", href: basePath },
    { value: "vsetko", label: "Všetky sezóny", href: `${basePath}?obdobie=vsetko` },
  ];
  return (
    <nav aria-label="Obdobie" className="mb-4 flex rounded-xl border border-line bg-surface p-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          replace
          scroll={false}
          aria-current={t.value === scope ? "page" : undefined}
          className={cn(
            "flex h-9 flex-1 items-center justify-center truncate rounded-lg px-2 text-sm font-medium transition-colors",
            t.value === scope ? "bg-elevated text-ink shadow-sm shadow-black/40" : "text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
