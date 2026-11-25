import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus, Trophy } from "lucide-react";
import { MatchCard } from "@/components/match-card";
import { parseScope, ScopeTabs } from "@/components/scope-tabs";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getGames, getGoals, getPlayedMatches, getPlayers } from "@/lib/data";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Zápasy" };

type Search = Promise<{ obdobie?: string }>;

async function Matches({ searchParams }: { searchParams: Search }) {
  const me = await requireMember();
  const scope = parseScope((await searchParams).obdobie);
  const seasonId = scope === "sezona" ? (me.season?.id ?? null) : null;
  const [matches, players] = await Promise.all([getPlayedMatches(seasonId), getPlayers()]);
  const [goals, games] = await Promise.all([getGoals(matches.map((m) => m.id)), getGames(matches.map((m) => m.id))]);
  const gamesOf = (id: string) => games.filter((g) => g.match_id === id).map((g) => ({ scoreA: g.score_a, scoreB: g.score_b }));
  const name = new Map(players.map((p) => [p.id, p.nickname]));
  // eslint-disable-next-line react-hooks/purity -- serverový komponent, čas požiadavky
  const now = Date.now();

  function scorers(matchId: string) {
    const counts = new Map<string, number>();
    for (const g of goals) {
      if (g.match_id !== matchId || g.is_own_goal) continue;
      counts.set(g.scorer_id, (counts.get(g.scorer_id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => (n > 1 ? `${name.get(id) ?? "?"} ${n}×` : (name.get(id) ?? "?")))
      .join(", ");
  }

  return (
    <div className="animate-rise">
      <PageHeader
        title="Zápasy"
        subtitle={matches.length > 0 ? `${plural(matches.length, "hrací večer", "hracie večery", "hracích večerov")} · ${plural(games.length, "zápas", "zápasy", "zápasov")}` : undefined}
        action={me.isAdmin ? <ButtonLink href="/zapasy/novy" icon={<Plus className="size-4" aria-hidden />}>Pridať zápas</ButtonLink> : undefined}
      />
      <ScopeTabs basePath="/zapasy" scope={scope} seasonName={me.season?.name ?? null} />

      {matches.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title="Zatiaľ žiadny zápas"
          text={me.isAdmin ? "Po odohraní termínu zapíš výsledok – štatistiky sa spočítajú samy." : "Výsledky sa objavia po prvom odohranom zápase."}
        />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              games={gamesOf(m.id)}
              mvpName={m.mvp_player_id ? name.get(m.mvp_player_id) : null}
              votingOpen={m.mvp_mode === "vote" && !m.mvp_finalized_at && !!m.mvp_voting_closes_at && Date.parse(m.mvp_voting_closes_at) > now}
              scorers={scorers(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchesPage(props: { searchParams: Search }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Matches searchParams={props.searchParams} />
    </Suspense>
  );
}
