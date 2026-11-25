"use client";

import { Award, Check, Lock } from "lucide-react";
import { useState } from "react";
import { castVoteAction } from "@/lib/actions/matches";
import type { MvpStatus, PlayerLite } from "@/lib/data";
import { cn, plural } from "@/lib/format";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { useAction } from "./use-action";

type Props = {
  matchId: string;
  status: MvpStatus;
  /** Hráči zo zostavy zápasu. */
  lineup: PlayerLite[];
  meId: string;
  winnerId: string | null;
  timeLeftLabel: string | null;
};

export function MvpVote({ matchId, status, lineup, meId, winnerId, timeLeftLabel }: Props) {
  const [choice, setChoice] = useState<string | null>(null);
  const { run, pending } = useAction(castVoteAction, { success: "Hlas je započítaný." });
  const byId = new Map(lineup.map((p) => [p.id, p]));

  // ── Uzavreté: výsledok ──
  if (status.closed) {
    const winner = winnerId ? byId.get(winnerId) : null;
    const tally = status.tally ?? [];
    const max = Math.max(1, ...tally.map((t) => t.votes));
    return (
      <div className="px-4 pb-4">
        {winner ? (
          <div className="flex items-center gap-3.5 rounded-2xl border border-warning/30 bg-warning/[0.07] p-3.5">
            <PlayerAvatar nickname={winner.nickname} avatarUrl={winner.avatarUrl} color={winner.avatarColor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                <Award className="size-3.5" aria-hidden />
                MVP
              </div>
              <div className="display mt-1 truncate text-2xl text-ink">{winner.nickname}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{status.mode === "vote" ? "Nikto nehlasoval, MVP nebol udelený." : "MVP v tomto zápase nebol určený."}</p>
        )}
        {status.mode === "vote" && tally.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2.5">
            {tally.map((t) => {
              const p = byId.get(t.player_id);
              if (!p) return null;
              return (
                <li key={t.player_id} className="flex items-center gap-2.5">
                  <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="xs" />
                  <span className="w-24 truncate text-sm text-ink">{p.nickname}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
                    <span className={cn("block h-full rounded-full", t.player_id === winnerId ? "bg-warning" : "bg-muted/50")} style={{ width: `${(t.votes / max) * 100}%` }} />
                  </span>
                  <span className="num w-5 text-right text-lg text-ink">{t.votes}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {status.mode === "manual" ? <p className="mt-2 text-xs text-muted">MVP určil admin.</p> : null}
      </div>
    );
  }

  const progress = (
    <p className="mt-3 text-center text-xs text-muted">
      Hlasovalo {status.votes_cast} z {status.voters}
      {timeLeftLabel ? ` · ostáva ${timeLeftLabel}` : ""} · výsledok sa zobrazí po uzavretí
    </p>
  );

  // ── Otvorené, ale nemôžem hlasovať ──
  if (!status.eligible) {
    return (
      <div className="px-4 pb-4">
        <p className="flex items-center gap-2 rounded-xl bg-bg/50 px-3 py-2.5 text-sm text-muted">
          <Lock className="size-4 shrink-0" aria-hidden />
          Hlasovať môžu iba hráči, ktorí v ten večer hrali aspoň jeden zápas.
        </p>
        {progress}
      </div>
    );
  }

  // ── Už som hlasoval ──
  if (status.my_vote) {
    const voted = byId.get(status.my_vote);
    return (
      <div className="px-4 pb-4">
        <p className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.07] px-3 py-2.5 text-sm text-ink">
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
          Hlasoval si za <span className="font-semibold">{voted?.nickname ?? "hráča"}</span>
        </p>
        {progress}
      </div>
    );
  }

  // ── Hlasovanie ──
  const candidates = lineup.filter((p) => p.id !== meId);
  return (
    <div className="px-4 pb-4">
      <p className="mb-3 text-sm text-muted">Vyber najlepšieho hráča večera. Hlas je tajný a nedá sa zmeniť.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Kandidáti na MVP">
        {candidates.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={choice === p.id}
            onClick={() => setChoice(p.id)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition active:scale-[0.98]",
              choice === p.id ? "border-primary bg-primary/10" : "border-line bg-bg/50 hover:border-line-strong",
            )}
          >
            <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.nickname}</span>
          </button>
        ))}
      </div>
      <Button className="mt-3 w-full" disabled={!choice} loading={pending} onClick={() => choice && run({ matchId, candidateId: choice })}>
        {choice ? `Odoslať hlas pre ${byId.get(choice)?.nickname}` : "Vyber hráča"}
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        Zatiaľ {plural(status.votes_cast, "hlas", "hlasy", "hlasov")} z {status.voters}
        {timeLeftLabel ? ` · ostáva ${timeLeftLabel}` : ""}
      </p>
    </div>
  );
}
