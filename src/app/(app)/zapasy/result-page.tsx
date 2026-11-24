import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ResultForm, type ResultInitial } from "@/components/result-form";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { getAttendance, getGoals, getLineups, getMatch, getPlayers, getSeasons, toLite } from "@/lib/data";
import { isoToLocalInput } from "@/lib/datetime";
import { balanceTeams } from "@/lib/teams";
import { Users } from "lucide-react";

/**
 * Spoločná obrazovka pre zápis výsledku termínu, opravu odohraného zápasu
 * a spätné doplnenie zápasu bez termínu (matchId = null).
 */
export async function ResultScreen({ matchId }: { matchId: string | null }) {
  const me = await requireAdmin();
  if (matchId && !/^[0-9a-f-]{36}$/i.test(matchId)) notFound();

  const [match, players, seasons] = await Promise.all([matchId ? getMatch(matchId) : null, getPlayers(), getSeasons()]);
  if (matchId && !match) notFound();
  if (match?.status === "cancelled") redirect(`/terminy/${match.id}`);

  const [lineup, goals, attendance] = match
    ? await Promise.all([getLineups([match.id]), getGoals([match.id]), getAttendance([match.id])])
    : [[], [], []];

  const external = match?.kind === "external";
  let assigned: ResultInitial["lineup"] = Object.fromEntries(lineup.map((l) => [l.player_id, l.team]));

  // Termín bez uložených tímov: predvyplníme z potvrdenej dochádzky.
  if (match && lineup.length === 0) {
    const going = players.filter((p) => attendance.some((a) => a.player_id === p.id && a.status === "yes"));
    if (external) {
      assigned = Object.fromEntries(going.map((p) => [p.id, "A" as const]));
    } else {
      const split = balanceTeams(going.map((p) => ({ id: p.id, skill: p.skill, position: p.position })), {}, () => 0.42);
      assigned = Object.fromEntries([...split.a.map((id) => [id, "A" as const]), ...split.b.map((id) => [id, "B" as const])]);
    }
  }

  const played = match?.status === "played";
  const initial: ResultInitial = {
    // eslint-disable-next-line react-hooks/purity -- serverový komponent, čas požiadavky
    startsAt: isoToLocalInput(match?.starts_at ?? new Date(Date.now() - 2 * 3_600_000)),
    seasonId: match?.season_id ?? me.season?.id ?? seasons[0]?.id ?? "",
    location: match?.location ?? "",
    kind: match?.kind ?? "internal",
    teamAName: match?.team_a_name ?? "Tím A",
    teamBName: match?.team_b_name ?? "Tím B",
    scoreA: match?.score_a ?? 0,
    scoreB: match?.score_b ?? 0,
    resultNote: match?.result_note ?? "",
    mvpMode: played ? match.mvp_mode : "vote",
    mvpPlayerId: played && match.mvp_mode === "manual" ? match.mvp_player_id : null,
    lineup: assigned,
    goals: goals.map((g) => ({ team: g.team, scorerId: g.scorer_id, assistId: g.assist_id ?? "", isOwnGoal: g.is_own_goal })),
  };

  // Aktívni hráči + tí, ktorí už v zostave sú (aj keby boli medzičasom deaktivovaní).
  const selectable = players.filter((p) => p.is_active || assigned[p.id]).map(toLite);
  const backHref = match ? (played ? `/zapasy/${match.id}` : `/terminy/${match.id}`) : "/zapasy";

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Späť
      </Link>
      <PageHeader
        title={played ? "Upraviť výsledok" : match ? "Zapísať výsledok" : "Pridať zápas"}
        subtitle={match ? undefined : "Spätné doplnenie zápasu, ktorý nemal termín v aplikácii."}
      />
      {seasons.length === 0 ? (
        <EmptyState icon={<Users />} title="Chýba sezóna" text="Najprv vytvor sezónu v Nastaveniach." />
      ) : (
        <ResultForm
          matchId={match?.id ?? null}
          initial={initial}
          players={selectable}
          seasons={seasons.map((s) => ({ id: s.id, name: s.name }))}
          voteHours={me.group.mvp_vote_hours}
          votingStarted={!!played && match.mvp_mode === "vote" && !!match.mvp_voting_closes_at}
        />
      )}
    </div>
  );
}
