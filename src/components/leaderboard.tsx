import Link from "next/link";
import type { ReactNode } from "react";
import type { PlayerLite } from "@/lib/data";
import { cn } from "@/lib/format";
import { PlayerAvatar } from "./player-avatar";

export type LeaderboardRow = { player: PlayerLite; value: number; display?: string; detail?: string };

type Props = {
  rows: LeaderboardRow[];
  /** Koľko riadkov zobraziť. */
  limit?: number;
  highlightId?: string;
  empty?: ReactNode;
};

/** Rebríček: poradie, hráč, hodnota a pruh úmerný lídrovi. Rovnaká hodnota = rovnaké poradie. */
export function Leaderboard({ rows, limit = 10, highlightId, empty }: Props) {
  const sorted = [...rows]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.player.nickname.localeCompare(b.player.nickname, "sk"))
    .slice(0, limit);

  if (sorted.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted">{empty ?? "Zatiaľ žiadne údaje."}</p>;
  }

  const max = sorted[0].value;

  return (
    <ol className="divide-y divide-line">
      {sorted.map((row) => {
        const rank = sorted.findIndex((r) => r.value === row.value) + 1;
        const leader = rank === 1;
        return (
          <li key={row.player.id}>
            <Link
              href={`/hraci/${row.player.id}`}
              className={cn(
                "relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-elevated/60",
                row.player.id === highlightId && "bg-primary/[0.04]",
              )}
            >
              <span className={cn("num w-5 text-center text-lg", leader ? "text-primary" : "text-muted")}>{rank}</span>
              <PlayerAvatar nickname={row.player.nickname} avatarUrl={row.player.avatarUrl} color={row.player.avatarColor} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-medium text-ink">
                  {row.player.nickname}
                  {row.player.id === highlightId ? <span className="ml-1.5 text-xs font-normal text-muted">ty</span> : null}
                </span>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
                  <span
                    className={cn("block h-full rounded-full", leader ? "bg-primary" : "bg-secondary/50")}
                    style={{ width: `${Math.max(6, (row.value / max) * 100)}%` }}
                  />
                </span>
              </span>
              <span className="text-right">
                <span className={cn("num block text-2xl", leader ? "text-primary" : "text-ink")}>{row.display ?? row.value}</span>
                {row.detail ? <span className="block text-[0.6875rem] text-muted">{row.detail}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
