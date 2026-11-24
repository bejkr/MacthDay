import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { TreasuryAddButton, TreasuryDeleteButton } from "@/components/treasury-admin";
import { Card, CardHeader, EmptyState, PageHeader, PageSkeleton, PlayerStat } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getBalances, getPlayers, getTreasuryEntries, getTreasurySummary, toLite } from "@/lib/data";
import { formatPlainDate, todayInZone } from "@/lib/datetime";
import { cn, formatMoney, TREASURY_LABEL } from "@/lib/format";
import type { Enum } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Pokladnica" };

// Ako typ transakcie pôsobí na hotovosť: +1 pribudne, −1 ubudne, 0 nemení (iba dlh).
const CASH_EFFECT: Record<Enum<"treasury_type">, 1 | 0 | -1> = { payment: 1, income: 1, expense: -1, fine: 0, contribution: 0 };

async function Treasury() {
  const me = await requireMember();
  const [summary, balances, entries, players] = await Promise.all([getTreasurySummary(), getBalances(), getTreasuryEntries(), getPlayers()]);
  const lite = new Map(players.map((p) => [p.id, toLite(p)]));
  const debtOf = new Map(balances.map((b) => [b.playerId, b.debt]));

  const listed = balances
    .filter((b) => lite.has(b.playerId) && (lite.get(b.playerId)!.isActive || b.debt !== 0))
    .sort((a, b) => b.debt - a.debt || lite.get(a.playerId)!.nickname.localeCompare(lite.get(b.playerId)!.nickname, "sk"));

  return (
    <div className="animate-rise">
      <PageHeader
        title="Pokladnica"
        subtitle="Hotovosť a dlhy sa počítajú z transakcií."
        action={
          me.isAdmin ? (
            <TreasuryAddButton
              today={todayInZone()}
              players={players.filter((p) => p.is_active || (debtOf.get(p.id) ?? 0) !== 0).map((p) => ({ id: p.id, nickname: p.nickname, debt: debtOf.get(p.id) ?? 0 }))}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <PlayerStat className="col-span-2 lg:col-span-1" label="Hotovosť v pokladnici" value={formatMoney(summary.cash)} hint="platby + príjmy − výdavky" accent />
        <PlayerStat label="Nezaplatené dlhy" value={formatMoney(summary.outstanding)} hint="všetci hráči spolu" />
        <PlayerStat
          label={summary.my_debt < 0 ? "Môj preplatok" : "Môj dlh"}
          value={<span className={summary.my_debt > 0 ? "text-danger" : undefined}>{formatMoney(Math.abs(summary.my_debt))}</span>}
          hint={summary.my_debt > 0 ? "treba doplatiť" : "si vyrovnaný"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
        <Card className="overflow-hidden">
          <CardHeader title={me.isAdmin ? "Zostatky hráčov" : "Môj zostatok"} className="pb-2" />
          <ul className="divide-y divide-line">
            {listed.map((b) => {
              const p = lite.get(b.playerId)!;
              return (
                <li key={b.playerId}>
                  <Link href={`/hraci/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50">
                    <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" dimmed={!p.isActive} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.nickname}</span>
                      <span className="block text-xs text-muted">
                        predpis {formatMoney(b.charged)} · zaplatené {formatMoney(b.paid)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn("num block text-xl", b.debt > 0 ? "text-danger" : b.debt < 0 ? "text-primary" : "text-muted")}>
                        {formatMoney(Math.abs(b.debt))}
                      </span>
                      <span className="block text-[0.6875rem] text-muted">{b.debt > 0 ? "dlh" : b.debt < 0 ? "preplatok" : "vyrovnané"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {!me.isAdmin ? <p className="px-4 pt-1 pb-4 text-xs text-muted">Zostatky ostatných hráčov vidí iba admin.</p> : null}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={me.isAdmin ? "Transakcie" : "Moje a spoločné transakcie"} className="pb-2" />
          {entries.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<Wallet />} title="Zatiaľ žiadne transakcie" text={me.isAdmin ? "Zapíš prvú pokutu, platbu alebo výdavok." : undefined} />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((e) => {
                const effect = CASH_EFFECT[e.type];
                const player = e.player_id ? lite.get(e.player_id) : null;
                const title = `${TREASURY_LABEL[e.type]}${player ? ` · ${player.nickname}` : ""}`;
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full",
                        effect > 0 ? "bg-primary/15 text-primary" : effect < 0 ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
                      )}
                    >
                      {effect > 0 ? <ArrowDownLeft className="size-4" aria-hidden /> : effect < 0 ? <ArrowUpRight className="size-4" aria-hidden /> : <Wallet className="size-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{title}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatPlainDate(e.entry_date)}
                        {e.note ? ` · ${e.note}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn("num block text-lg", effect > 0 ? "text-primary" : effect < 0 ? "text-danger" : "text-ink")}>
                        {effect > 0 ? "+" : effect < 0 ? "−" : ""}
                        {formatMoney(e.amount)}
                      </span>
                      <span className="block text-[0.6875rem] text-muted">{effect === 0 ? "predpis (dlh)" : "hotovosť"}</span>
                    </span>
                    {me.isAdmin ? <TreasuryDeleteButton id={e.id} label={`${title} ${formatMoney(e.amount)}`} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function TreasuryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Treasury />
    </Suspense>
  );
}
