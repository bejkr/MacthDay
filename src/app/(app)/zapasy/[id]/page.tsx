import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Award, Pencil } from "lucide-react";
import { AwardsGrid, awardInput } from "@/components/awards";
import { DeleteMatchButton } from "@/components/event-admin";
import { Lineups } from "@/components/lineups";
import { GameChips, Scoreline } from "@/components/match-card";
import { MvpVote } from "@/components/mvp-vote";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { computeAwards } from "@/lib/awards";
import { getAttendance, getGames, getGoals, getLineups, getMatch, getMvpStatus, getPlayers, tick, toLite, type PlayerLite } from "@/lib/data";
import { formatDate, formatTime, formatWeekday, timeLeft } from "@/lib/datetime";
import { cn } from "@/lib/format";
import type { Goal, LineupRow, Match } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Zápas" };

type GameView = { id: string; seq: number; scoreA: number; scoreB: number; lineup: LineupRow[]; goals: Goal[] };

function GameSection({
  match, game, lite, showScore,
}: { match: Match; game: GameView; lite: Map<string, PlayerLite>; showScore: boolean }) {
  const external = match.kind === "external";
  const team = (side: "A" | "B") =>
    game.lineup.filter((l) => l.team === side).map((l) => lite.get(l.player_id)).filter((p): p is PlayerLite => !!p)
      .sort((x, y) => x.nickname.localeCompare(y.nickname, "sk"));
  const a = game.scoreA;
  const b = game.scoreB;

  const extra = (p: PlayerLite) => {
    const g = game.goals.filter((x) => x.scorer_id === p.id && !x.is_own_goal).length;
    const as = game.goals.filter((x) => x.assist_id === p.id).length;
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs">
        {g > 0 ? <span className="font-semibold text-primary">{g} G</span> : null}
        {as > 0 ? <span className="text-muted">{as} A</span> : null}
      </span>
    );
  };

  return (
    <Card className="mt-4">
      <CardHeader title={showScore ? `Zápas ${game.seq}` : "Góly a zostavy"} />
      {showScore ? (
        <div className="px-4 pt-3">
          <Scoreline match={match} score={{ a, b }} />
        </div>
      ) : null}
      {game.goals.length > 0 ? (
        <ol className="flex flex-col gap-1 px-4 pt-4">
          {game.goals.map((g) => {
            const scorer = lite.get(g.scorer_id);
            const assist = g.assist_id ? lite.get(g.assist_id) : null;
            return (
              <li key={g.id} className={cn("flex items-center gap-2 text-sm", g.team === "A" ? "justify-start" : "flex-row-reverse text-right")}>
                <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{scorer?.nickname ?? "?"}</span>
                  {g.is_own_goal ? <span className="ml-1.5 text-xs text-danger">vlastný</span> : null}
                  {assist ? <span className="ml-1.5 text-xs text-muted">as. {assist.nickname}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {game.goals.filter((g) => g.team === "A").length < a || game.goals.filter((g) => g.team === "B").length < b ? (
        <p className="px-4 pt-2 text-xs text-muted">{external ? "Góly súpera sa strelcom nepriraďujú." : "Niektoré góly nemajú priradeného strelca."}</p>
      ) : null}
      <div className="p-4">
        <Lineups
          teamAName={match.team_a_name}
          teamBName={match.team_b_name}
          teamA={team("A")}
          teamB={team("B")}
          extra={extra}
          winner={a > b ? "A" : b > a ? "B" : null}
          single={external}
        />
      </div>
    </Card>
  );
}

async function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await tick(); // uzavrie hlasovanie, ak práve vypršalo
  const match = await getMatch(id);
  if (!match) notFound();
  if (match.status !== "played") redirect(`/terminy/${match.id}`);

  const [players, lineup, goals, gameRows, mvp, attendance] = await Promise.all([
    getPlayers(), getLineups([id]), getGoals([id]), getGames([id]), getMvpStatus(id), getAttendance([id]),
  ]);
  const awards = computeAwards(awardInput(gameRows, lineup, goals, attendance));
  const lite = new Map(players.map((p) => [p.id, toLite(p)]));
  const games: GameView[] = gameRows.map((g) => ({
    id: g.id,
    seq: g.seq,
    scoreA: g.score_a,
    scoreB: g.score_b,
    lineup: lineup.filter((l) => l.game_id === g.id),
    goals: goals.filter((x) => x.game_id === g.id),
  }));
  const multi = games.length > 1;

  // Hráči večera (každý raz) – kandidáti na MVP
  const eveningPlayers = [...new Set(lineup.filter((l) => l.game_id).map((l) => l.player_id))]
    .map((pid) => lite.get(pid))
    .filter((p): p is PlayerLite => !!p)
    .sort((x, y) => x.nickname.localeCompare(y.nickname, "sk"));
  const mvpPlayer = match.mvp_player_id ? lite.get(match.mvp_player_id) : null;

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <Link href="/zapasy" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Zápasy
      </Link>

      <Card className="pitch px-4 py-6 sm:px-6">
        <p className="mb-5 text-center text-xs text-muted">
          <span className="capitalize">{formatWeekday(match.starts_at)}</span> {formatDate(match.starts_at)} · {formatTime(match.starts_at)}
          {match.location ? ` · ${match.location}` : ""}
        </p>
        {multi ? (
          <>
            <h1 className="display mb-4 text-center text-3xl text-ink">{games.length} zápasy</h1>
            <GameChips games={games} />
          </>
        ) : games[0] ? (
          <>
            <h1 className="sr-only">
              {match.team_a_name} {games[0].scoreA}:{games[0].scoreB} {match.team_b_name}
            </h1>
            <Scoreline match={match} size="lg" score={{ a: games[0].scoreA, b: games[0].scoreB }} />
          </>
        ) : null}
        {mvpPlayer && match.mvp_finalized_at ? (
          <p className="mt-5 flex items-center justify-center gap-1.5 text-sm text-warning">
            <Award className="size-4" aria-hidden />
            MVP večera: <span className="font-semibold">{mvpPlayer.nickname}</span>
          </p>
        ) : null}
        {match.result_note ? <p className="mt-5 text-center text-sm whitespace-pre-line text-ink/80">{match.result_note}</p> : null}
      </Card>

      {awards.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Ocenenia večera" />
          <AwardsGrid awards={awards} players={lite} />
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title={multi ? "MVP večera" : "MVP zápasu"} />
        <div className="pt-3">
          <MvpVote
            matchId={match.id}
            status={mvp}
            lineup={eveningPlayers}
            meId={me.player.id}
            winnerId={match.mvp_player_id}
            timeLeftLabel={match.mvp_voting_closes_at ? timeLeft(match.mvp_voting_closes_at) : null}
          />
        </div>
      </Card>

      {games.map((g) => (
        <GameSection key={g.id} match={match} game={g} lite={lite} showScore={multi} />
      ))}

      {me.isAdmin ? (
        <div className="mt-5 flex flex-wrap gap-2.5">
          <ButtonLink href={`/zapasy/${match.id}/vysledok`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
            {multi ? "Upraviť večer" : "Upraviť výsledok"}
          </ButtonLink>
          <DeleteMatchButton matchId={match.id} redirectTo="/zapasy" played />
        </div>
      ) : null}
    </div>
  );
}

export default function MatchPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MatchDetail params={props.params} />
    </Suspense>
  );
}
