import {
  AlarmClock, CloudRain, Flame, Footprints, Handshake, HelpCircle, Sparkles, Target, Trophy, Users, type LucideIcon,
} from "lucide-react";
import type { Award, AwardInput, AwardKey } from "@/lib/awards";
import type { PlayerLite } from "@/lib/data";
import { cn } from "@/lib/format";
import type { Attendance, Game, Goal, LineupRow } from "@/lib/supabase/database.types";
import { PlayerAvatar } from "./player-avatar";

const STYLE: Record<AwardKey, { icon: LucideIcon; tone: string }> = {
  hattrick: { icon: Flame, tone: "bg-warning/15 text-warning" },
  top_scorer: { icon: Target, tone: "bg-primary/15 text-primary" },
  playmaker: { icon: Handshake, tone: "bg-primary/15 text-primary" },
  duo: { icon: Users, tone: "bg-primary/15 text-primary" },
  winner: { icon: Trophy, tone: "bg-warning/15 text-warning" },
  own_goal: { icon: Footprints, tone: "bg-danger/15 text-danger" },
  unlucky: { icon: CloudRain, tone: "bg-elevated text-muted" },
  last_minute: { icon: AlarmClock, tone: "bg-elevated text-muted" },
  maybe_came: { icon: HelpCircle, tone: "bg-elevated text-muted" },
  surprise: { icon: Sparkles, tone: "bg-elevated text-muted" },
};

/** Prevedie riadky z databázy na vstup pre výpočet ocenení. */
export function awardInput(games: Game[], lineup: LineupRow[], goals: Goal[], attendance: Attendance[]): AwardInput {
  return {
    games: games.map((g) => ({ id: g.id, seq: g.seq, scoreA: g.score_a, scoreB: g.score_b })),
    lineup: lineup.filter((l) => l.game_id).map((l) => ({ gameId: l.game_id!, playerId: l.player_id, team: l.team })),
    goals: goals.filter((g) => g.game_id).map((g) => ({
      gameId: g.game_id!, team: g.team, scorerId: g.scorer_id, assistId: g.assist_id, isOwnGoal: g.is_own_goal,
    })),
    attendance: attendance.map((a) => ({ playerId: a.player_id, status: a.status, updatedAt: a.updated_at })),
  };
}

function names(award: Award, players: Map<string, PlayerLite>) {
  const list = award.playerIds.map((id) => players.get(id)?.nickname ?? "?");
  return award.key === "duo" ? list.join(" → ") : list.join(", ");
}

/** Ocenenia večera ako mriežka kartičiek. */
export function AwardsGrid({ awards, players }: { awards: Award[]; players: Map<string, PlayerLite> }) {
  return (
    <ul className="grid gap-2 p-4 sm:grid-cols-2">
      {awards.map((award) => {
        const { icon: Icon, tone } = STYLE[award.key];
        const first = players.get(award.playerIds[0]);
        return (
          <li key={award.key} className="flex items-center gap-3 rounded-2xl border border-line bg-bg/50 p-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", tone)}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{award.title}</span>
              <span className="block truncate text-sm text-ink/90">{names(award, players)}</span>
              <span className="block text-xs text-muted">{award.detail}</span>
            </span>
            {first && award.playerIds.length === 1 ? (
              <PlayerAvatar nickname={first.nickname} avatarUrl={first.avatarUrl} color={first.avatarColor} size="sm" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Kompaktný rad ocenení (napr. pod posledným zápasom na Prehľade). */
export function AwardChips({ awards, players, limit = 4 }: { awards: Award[]; players: Map<string, PlayerLite>; limit?: number }) {
  const shown = awards.slice(0, limit);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((award) => {
        const { icon: Icon, tone } = STYLE[award.key];
        return (
          <li key={award.key} className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-xs">
            <span className={cn("flex size-6 items-center justify-center rounded-full", tone)}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="font-semibold text-ink">{award.title}</span>
            <span className="max-w-[9rem] truncate text-muted">{names(award, players)}</span>
          </li>
        );
      })}
      {awards.length > limit ? <li className="self-center px-1 text-xs text-muted">+{awards.length - limit}</li> : null}
    </ul>
  );
}
