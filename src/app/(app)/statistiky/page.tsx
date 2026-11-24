import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { Leaderboard, type LeaderboardRow } from "@/components/leaderboard";
import { PlayerCompare } from "@/components/player-compare";
import { parseScope, ScopeTabs } from "@/components/scope-tabs";
import { Card, CardHeader, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getGoals, getPlayedMatches, getPlayers, getStats, toLite } from "@/lib/data";
import { formatDayMonth } from "@/lib/datetime";
import type { PlayerStats } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Štatistiky" };

type Search = Promise<{ obdobie?: string }>;

async function Stats({ searchParams }: { searchParams: Search }) {
  const me = await requireMember();
  const scope = parseScope((await searchParams).obdobie);
  const seasonId = scope === "sezona" ? (me.season?.id ?? null) : null;

  const [players, stats, matches] = await Promise.all([getPlayers(), getStats(seasonId), getPlayedMatches(seasonId, 300)]);
  const goals = await getGoals(matches.map((m) => m.id));

  const lite = new Map(players.map((p) => [p.id, toLite(p)]));
  // V rebríčkoch sú aktívni hráči a tí neaktívni, ktorí v danom období hrali.
  // Zmazaní hráči ostávajú v histórii zápasov, ale v rebríčkoch nie.
  const rows = stats.filter((s) => {
    const p = lite.get(s.player_id);
    return !!p && !p.isDeleted && (p.isActive || s.matches_played > 0);
  });

  const board = (value: (s: PlayerStats) => number, extra?: (s: PlayerStats) => Partial<LeaderboardRow>): LeaderboardRow[] =>
    rows.map((s) => ({ player: lite.get(s.player_id)!, value: value(s), ...extra?.(s) }));

  const totalMatches = matches.length;
  // Aby rebríček "góly na zápas" nevyhral hráč s jedným zápasom, treba odohrať aspoň štvrtinu.
  const minMatches = Math.max(1, Math.ceil(totalMatches / 4));

  const chronological = [...matches].reverse();
  const index = new Map(chronological.map((m, i) => [m.id, i]));
  const contributions: Record<string, number[]> = {};
  const add = (playerId: string | null, matchId: string) => {
    if (!playerId) return;
    const arr = (contributions[playerId] ??= new Array(chronological.length).fill(0));
    arr[index.get(matchId)!] += 1;
  };
  for (const g of goals) {
    if (!g.is_own_goal) add(g.scorer_id, g.match_id);
    add(g.assist_id, g.match_id);
  }

  const comparable = rows.map((s) => lite.get(s.player_id)!).sort((x, y) => x.nickname.localeCompare(y.nickname, "sk"));
  const byPoints = [...rows].sort((x, y) => y.goals + y.assists - (x.goals + x.assists));
  const defaultA = comparable.some((p) => p.id === me.player.id) ? me.player.id : (byPoints[0]?.player_id ?? "");
  const defaultB = byPoints.find((s) => s.player_id !== defaultA)?.player_id ?? "";

  const sections: { title: string; rows: LeaderboardRow[]; empty: string }[] = [
    { title: "Najlepší strelci", rows: board((s) => s.goals, (s) => ({ detail: `${s.matches_played} záp.` })), empty: "Zatiaľ žiadne góly." },
    { title: "Najlepší asistenti", rows: board((s) => s.assists, (s) => ({ detail: `${s.matches_played} záp.` })), empty: "Zatiaľ žiadne asistencie." },
    { title: "Najviac MVP", rows: board((s) => s.mvps), empty: "Zatiaľ žiadne ocenenia." },
    {
      title: "Góly na zápas",
      rows: board(
        (s) => (s.matches_played >= minMatches ? s.goals / s.matches_played : 0),
        (s) => ({ display: (s.goals / Math.max(1, s.matches_played)).toFixed(2).replace(".", ","), detail: `${s.goals} G / ${s.matches_played} záp.` }),
      ),
      empty: "Zatiaľ žiadne góly.",
    },
    {
      title: "Najvyššia dochádzka",
      rows: board((s) => s.attendance_pct ?? 0, (s) => ({ display: `${s.attendance_pct ?? 0} %`, detail: `z ${s.eligible_matches} záp.` })),
      empty: "Dochádzka sa počíta z odohraných zápasov.",
    },
    { title: "Najviac odohraných zápasov", rows: board((s) => s.matches_played, (s) => ({ detail: `${s.wins}V ${s.draws}R ${s.losses}P` })), empty: "Zatiaľ žiadne zápasy." },
  ];

  return (
    <div className="animate-rise">
      <PageHeader title="Štatistiky" subtitle="Počítané priamo zo zápisov zápasov." />
      <ScopeTabs basePath="/statistiky" scope={scope} seasonName={me.season?.name ?? null} />

      {totalMatches === 0 ? (
        <EmptyState icon={<BarChart3 />} title="Zatiaľ nie je čo počítať" text="Rebríčky sa naplnia po prvom odohranom zápase v tomto období." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {sections.map((section) => (
              <Card key={section.title} className="overflow-hidden">
                <CardHeader title={section.title} className="pb-2" />
                <Leaderboard rows={section.rows} highlightId={me.player.id} limit={8} empty={section.empty} />
              </Card>
            ))}
          </div>
          <Card className="mt-4">
            <CardHeader title="Porovnanie hráčov" />
            <PlayerCompare
              key={scope}
              players={comparable}
              stats={rows}
              timeline={chronological.map((m) => formatDayMonth(m.starts_at))}
              contributions={contributions}
              defaultA={defaultA}
              defaultB={defaultB}
            />
          </Card>
        </>
      )}
    </div>
  );
}

export default function StatsPage(props: { searchParams: Search }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Stats searchParams={props.searchParams} />
    </Suspense>
  );
}
