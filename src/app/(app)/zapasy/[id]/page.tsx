import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Award, Pencil } from "lucide-react";
import { DeleteMatchButton } from "@/components/event-admin";
import { Lineups } from "@/components/lineups";
import { Scoreline } from "@/components/match-card";
import { MvpVote } from "@/components/mvp-vote";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getGoals, getLineups, getMatch, getMvpStatus, getPlayers, tick, toLite, type PlayerLite } from "@/lib/data";
import { formatDate, formatTime, formatWeekday, timeLeft } from "@/lib/datetime";
import { cn } from "@/lib/format";

export const metadata: Metadata = { title: "Zápas" };

async function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await tick(); // uzavrie hlasovanie, ak práve vypršalo
  const match = await getMatch(id);
  if (!match) notFound();
  if (match.status !== "played") redirect(`/terminy/${match.id}`);

  const [players, lineup, goals, mvp] = await Promise.all([getPlayers(), getLineups([id]), getGoals([id]), getMvpStatus(id)]);
  const lite = new Map(players.map((p) => [p.id, toLite(p)]));
  const team = (side: "A" | "B") =>
    lineup.filter((l) => l.team === side).map((l) => lite.get(l.player_id)).filter((p): p is PlayerLite => !!p)
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"));
  const teamA = team("A");
  const teamB = team("B");
  const a = match.score_a ?? 0;
  const b = match.score_b ?? 0;
  const external = match.kind === "external";

  const goalsOf = (pid: string) => goals.filter((g) => g.scorer_id === pid && !g.is_own_goal).length;
  const assistsOf = (pid: string) => goals.filter((g) => g.assist_id === pid).length;

  const extra = (p: PlayerLite) => {
    const g = goalsOf(p.id);
    const as = assistsOf(p.id);
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs">
        {match.mvp_player_id === p.id ? <Award className="size-3.5 text-warning" aria-label="MVP" /> : null}
        {g > 0 ? <span className="font-semibold text-primary">{g} G</span> : null}
        {as > 0 ? <span className="text-muted">{as} A</span> : null}
      </span>
    );
  };

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
        <h1 className="sr-only">
          {match.team_a_name} {a}:{b} {match.team_b_name}
        </h1>
        <Scoreline match={match} size="lg" />
        {match.result_note ? <p className="mt-5 text-center text-sm whitespace-pre-line text-ink/80">{match.result_note}</p> : null}
      </Card>

      {goals.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Góly" />
          <ol className="flex flex-col gap-1 p-4">
            {goals.map((g) => {
              const scorer = lite.get(g.scorer_id);
              const assist = g.assist_id ? lite.get(g.assist_id) : null;
              const left = g.team === "A";
              return (
                <li key={g.id} className={cn("flex items-center gap-2 text-sm", left ? "justify-start" : "flex-row-reverse text-right")}>
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
          {goals.filter((g) => g.team === "A").length < a || goals.filter((g) => g.team === "B").length < b ? (
            <p className="px-4 pb-4 text-xs text-muted">{external ? "Góly súpera sa strelcom nepriraďujú." : "Niektoré góly nemajú priradeného strelca."}</p>
          ) : null}
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="MVP zápasu" />
        <div className="pt-3">
          <MvpVote
            matchId={match.id}
            status={mvp}
            lineup={[...teamA, ...teamB]}
            meId={me.player.id}
            winnerId={match.mvp_player_id}
            timeLeftLabel={match.mvp_voting_closes_at ? timeLeft(match.mvp_voting_closes_at) : null}
          />
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title={external ? "Zostava" : "Zostavy"} />
        <div className="p-4">
          <Lineups
            teamAName={match.team_a_name}
            teamBName={match.team_b_name}
            teamA={teamA}
            teamB={teamB}
            extra={extra}
            winner={a > b ? "A" : b > a ? "B" : null}
            single={external}
          />
        </div>
      </Card>

      {me.isAdmin ? (
        <div className="mt-5 flex flex-wrap gap-2.5">
          <ButtonLink href={`/zapasy/${match.id}/vysledok`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
            Upraviť výsledok
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
