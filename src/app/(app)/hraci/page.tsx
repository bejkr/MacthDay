import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, ShieldCheck, Star } from "lucide-react";
import { PlayerCreateButton } from "@/components/player-admin";
import { PlayerAvatar } from "@/components/player-avatar";
import { Badge, PageHeader, PageSkeleton, SectionTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getPlayers, getStats, toLite } from "@/lib/data";
import { cn, plural, POSITION_LABEL } from "@/lib/format";
import type { Player, PlayerStats } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Hráči" };

function Row({ player, stats, isMe }: { player: Player; stats: PlayerStats | undefined; isMe: boolean }) {
  const p = toLite(player);
  return (
    <Link
      href={`/hraci/${p.id}`}
      className={cn("flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong", !p.isActive && "opacity-55")}
    >
      <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="lg" jerseyNumber={p.jerseyNumber} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold text-ink">{p.nickname}</span>
          {isMe ? <Badge tone="green">ty</Badge> : null}
          {p.role === "admin" ? <ShieldCheck className="size-4 shrink-0 text-primary" aria-label="Admin" /> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span>{p.position ? POSITION_LABEL[p.position] : "Univerzál"}</span>
          <span className="flex items-center gap-0.5" aria-label={`Hodnotenie ${p.skill} z 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={cn("size-3", n <= p.skill ? "fill-warning text-warning" : "text-line-strong")} aria-hidden />
            ))}
          </span>
          {!p.isActive ? <span>· neaktívny</span> : null}
        </div>
      </div>
      <dl className="flex shrink-0 gap-3.5 text-center">
        {[
          ["Z", stats?.matches_played ?? 0],
          ["G", stats?.goals ?? 0],
          ["A", stats?.assists ?? 0],
        ].map(([label, value]) => (
          <div key={label}>
            <dd className={cn("num text-xl", label === "G" && Number(value) > 0 ? "text-primary" : "text-ink")}>{value}</dd>
            <dt className="text-[0.625rem] font-semibold text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <ChevronRight className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />
    </Link>
  );
}

async function Players() {
  const me = await requireMember();
  const [players, stats] = await Promise.all([getPlayers(), getStats(me.season?.id ?? null)]);
  const statOf = new Map(stats.map((s) => [s.player_id, s]));
  const active = players.filter((p) => p.is_active);
  const inactive = players.filter((p) => !p.is_active && !p.deleted_at);

  return (
    <div className="animate-rise">
      <PageHeader
        title="Hráči"
        subtitle={`${plural(active.length, "hráč", "hráči", "hráčov")} · čísla za ${me.season ? `sezónu ${me.season.name}` : "všetky sezóny"}`}
        action={me.isAdmin ? <PlayerCreateButton /> : undefined}
      />
      <div className="grid gap-2.5 lg:grid-cols-2">
        {active.map((p) => (
          <Row key={p.id} player={p} stats={statOf.get(p.id)} isMe={p.id === me.player.id} />
        ))}
      </div>
      {inactive.length > 0 ? (
        <>
          <SectionTitle>Neaktívni</SectionTitle>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {inactive.map((p) => (
              <Row key={p.id} player={p} stats={statOf.get(p.id)} isMe={false} />
            ))}
          </div>
        </>
      ) : null}
      <p className="mt-4 text-center text-xs text-muted">Z = zápasy · G = góly · A = asistencie</p>
    </div>
  );
}

export default function PlayersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Players />
    </Suspense>
  );
}
