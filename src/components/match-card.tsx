import Link from "next/link";
import { Award, ChevronRight, MapPin, Users } from "lucide-react";
import { formatDay, formatMonthShort, formatTime, formatWeekdayShort, formatDate, relativeDay } from "@/lib/datetime";
import { cn } from "@/lib/format";
import type { Enum, Match } from "@/lib/supabase/database.types";
import { AttendanceStatus } from "./attendance";
import { Badge } from "./ui/card";

/** Dátum ako "lístok": deň v týždni, veľké číslo, mesiac. */
export function DateBlock({ date, muted }: { date: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5",
        muted ? "border-line bg-bg/40" : "border-primary/25 bg-primary/[0.07]",
      )}
    >
      <span className={cn("text-[0.625rem] font-semibold tracking-wider uppercase", muted ? "text-muted" : "text-primary")}>
        {formatWeekdayShort(date)}
      </span>
      <span className="num text-2xl text-ink">{formatDay(date)}</span>
      <span className="text-[0.625rem] tracking-wide text-muted uppercase">{formatMonthShort(date)}</span>
    </div>
  );
}

type EventProps = {
  match: Match;
  yesCount: number;
  myStatus: Enum<"attendance_status"> | null;
};

/** Karta nadchádzajúceho termínu v zozname. */
export function EventCard({ match, yesCount, myStatus }: EventProps) {
  const cancelled = match.status === "cancelled";
  return (
    <Link
      href={`/terminy/${match.id}`}
      className={cn(
        "flex items-center gap-3.5 rounded-card border border-line bg-surface p-3.5 transition-colors hover:border-line-strong",
        cancelled && "opacity-60",
      )}
    >
      <DateBlock date={match.starts_at} muted={cancelled} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="num text-xl text-ink">{formatTime(match.starts_at)}</span>
          <span className="text-xs text-muted">{relativeDay(match.starts_at)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{match.location || "Miesto neurčené"}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {cancelled ? <Badge tone="danger">Zrušené</Badge> : <AttendanceStatus status={myStatus} />}
          <Badge>
            <Users className="size-3" aria-hidden />
            {yesCount}
            {match.max_players ? ` / ${match.max_players}` : ""}
          </Badge>
          {match.kind === "external" ? <Badge>vs {match.team_b_name}</Badge> : null}
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

type ScoreProps = { match: Match; size?: "md" | "lg"; score?: { a: number; b: number } };

/** Výsledok: tím – skóre – tím. Víťazná strana je zvýraznená. */
export function Scoreline({ match, size = "md", score }: ScoreProps) {
  const a = score?.a ?? match.score_a ?? 0;
  const b = score?.b ?? match.score_b ?? 0;
  const name = "min-w-0 flex-1 truncate font-semibold";
  const text = size === "lg" ? "text-base" : "text-sm";
  return (
    <div className="flex items-center gap-3">
      <span className={cn(name, text, "text-right", a >= b ? "text-ink" : "text-muted")}>{match.team_a_name}</span>
      <span className={cn("num flex shrink-0 items-center gap-1.5", size === "lg" ? "text-6xl" : "text-3xl")}>
        <span className={a > b ? "text-primary" : "text-ink"}>{a}</span>
        <span className="text-muted/50">:</span>
        <span className={b > a ? "text-primary" : "text-ink"}>{b}</span>
      </span>
      <span className={cn(name, text, b >= a ? "text-ink" : "text-muted")}>{match.team_b_name}</span>
    </div>
  );
}

type MatchCardProps = {
  match: Match;
  /** Zápasy večera v poradí. */
  games: { scoreA: number; scoreB: number }[];
  mvpName?: string | null;
  votingOpen?: boolean;
  scorers?: string;
};

/** Výsledky všetkých zápasov večera ako rad čipov: „1. 3:2“, „2. 1:4“… */
export function GameChips({ games }: { games: { scoreA: number; scoreB: number }[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5">
      {games.map((g, i) => (
        <li key={i} className="flex items-baseline gap-1.5 rounded-lg border border-line bg-bg/50 px-2.5 py-1">
          <span className="text-[0.6875rem] font-semibold text-muted">{i + 1}.</span>
          <span className="num text-lg text-ink">
            {g.scoreA}:{g.scoreB}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Karta odohraného večera – pri jednom zápase výsledok, pri viacerých výsledky všetkých zápasov. */
export function MatchCard({ match, games, mvpName, votingOpen, scorers }: MatchCardProps) {
  return (
    <Link
      href={`/zapasy/${match.id}`}
      className="block rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong"
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {formatDate(match.starts_at)}
          {match.location ? ` · ${match.location}` : ""}
        </span>
        {votingOpen ? (
          <Badge tone="green">Hlasuj za MVP</Badge>
        ) : mvpName ? (
          <Badge tone="warning">
            <Award className="size-3" aria-hidden />
            {mvpName}
          </Badge>
        ) : null}
      </div>
      {games.length > 1 ? (
        <>
          <p className="mb-2 text-center text-sm font-semibold text-ink">{games.length} zápasy · {match.team_a_name} vs {match.team_b_name}</p>
          <GameChips games={games} />
        </>
      ) : (
        <Scoreline match={match} score={games[0] ? { a: games[0].scoreA, b: games[0].scoreB } : undefined} />
      )}
      {scorers ? <p className="mt-3 truncate text-center text-xs text-muted">{scorers}</p> : null}
    </Link>
  );
}
