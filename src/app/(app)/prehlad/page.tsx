import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Award, CalendarPlus, ChevronRight, ClipboardPen, Clock, Footprints, Goal, MapPin, Vote } from "lucide-react";
import { RsvpButtons } from "@/components/attendance";
import { MatchCard } from "@/components/match-card";
import { PollCard } from "@/components/poll-card";
import { PlayerAvatar } from "@/components/player-avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageSkeleton, PlayerStat, SectionTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import {
  byId, getAttendance, getGroupSummary, getMvpStatus, getPlayedMatches, getPlayers, getPolls, getStats,
  getTreasurySummary, getUnresolvedMatches, getUpcomingMatches, tick, toLite, type PlayerLite,
} from "@/lib/data";
import { formatDayMonth, formatTime, formatWeekday, relativeDay, timeLeft } from "@/lib/datetime";
import { defaultEventValues } from "@/lib/event-defaults";
import { formatMoney, plural, pluralWord } from "@/lib/format";
import type { PlayerStats } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Prehľad" };

function Leader({
  label, icon, player, value, unit,
}: { label: string; icon: React.ReactNode; player: PlayerLite | undefined; value: number; unit: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      {player ? (
        <div className="mt-3 flex items-center gap-2.5">
          <PlayerAvatar nickname={player.nickname} avatarUrl={player.avatarUrl} color={player.avatarColor} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{player.nickname}</div>
            <div className="text-xs text-muted">{unit}</div>
          </div>
          <div className="num text-3xl text-primary">{value}</div>
        </div>
      ) : (
        <div className="mt-3 flex h-10 items-center text-sm text-muted">Zatiaľ nikto</div>
      )}
    </>
  );
  const className = "block rounded-2xl border border-line bg-surface p-3.5";
  return player ? (
    <Link href={`/hraci/${player.id}`} className={`${className} transition-colors hover:border-line-strong`}>{inner}</Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function top(stats: PlayerStats[], key: "goals" | "assists" | "mvps") {
  const best = [...stats].sort((a, b) => b[key] - a[key] || a.matches_played - b.matches_played)[0];
  return best && best[key] > 0 ? best : undefined;
}

async function Dashboard() {
  const me = await requireMember();
  await tick();

  const seasonId = me.season?.id ?? null;
  const [upcoming, played, players, stats, summary, treasury, unresolved] = await Promise.all([
    getUpcomingMatches(5),
    getPlayedMatches(null, 3),
    getPlayers(),
    getStats(seasonId),
    getGroupSummary(seasonId),
    getTreasurySummary(),
    me.isAdmin ? getUnresolvedMatches() : Promise.resolve([]),
  ]);
  const polls = await getPolls();
  // Ankety, z ktorých ešte nevznikol termín, sú na Prehľade vždy – celé, aby sa dalo hlasovať hneď tu.
  const activePolls = polls.filter((p) => p.status !== "converted");

  const lite = byId(players.map(toLite));
  const playersById = Object.fromEntries(lite);
  const next = upcoming.find((m) => m.status === "scheduled");
  const attendance = next ? await getAttendance([next.id]) : [];
  const going = attendance.filter((a) => a.status === "yes");
  const mine = attendance.find((a) => a.player_id === me.player.id)?.status ?? null;
  const activeCount = players.filter((p) => p.is_active).length;
  const unanswered = next ? activeCount - attendance.filter((a) => lite.get(a.player_id)?.isActive).length : 0;

  // Zápasy, kde ešte môžem hlasovať za MVP
  // eslint-disable-next-line react-hooks/purity -- serverový komponent, čas požiadavky
  const now = Date.now();
  const votable = played.filter(
    (m) => m.mvp_mode === "vote" && !m.mvp_finalized_at && m.mvp_voting_closes_at && Date.parse(m.mvp_voting_closes_at) > now,
  );
  const statuses = await Promise.all(votable.map((m) => getMvpStatus(m.id)));
  const toVote = votable.filter((_, i) => statuses[i].eligible && !statuses[i].my_vote);

  const last = played[0];
  const ranked = stats.filter((s) => lite.has(s.player_id) && !lite.get(s.player_id)!.isDeleted);
  const scorer = top(ranked, "goals");
  const assister = top(ranked, "assists");
  const mvp = top(ranked, "mvps");
  const signupOpen = next ? now < Date.parse(next.signup_closes_at ?? next.starts_at) : false;
  const full = next?.max_players != null && going.length >= next.max_players;

  return (
    <div className="animate-rise">
      <header className="mb-5">
        <p className="eyebrow">{me.season ? `Sezóna ${me.season.name}` : "Bez aktívnej sezóny"}</p>
        <h1 className="display mt-1.5 text-[2.25rem] text-ink sm:text-5xl">{me.group.name}</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          {activePolls.map((p) => (
            <PollCard key={p.id} poll={p} players={playersById} meId={me.player.id} isAdmin={me.isAdmin} defaultEvent={defaultEventValues()} />
          ))}

          {/* Najbližší termín */}
          {next ? (
            <Card className="pitch overflow-hidden p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="eyebrow !text-primary">Najbližší termín</span>
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-bg">{relativeDay(next.starts_at)}</span>
              </div>
              <Link href={`/terminy/${next.id}`} className="group mt-4 block">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted capitalize">{formatWeekday(next.starts_at)}</div>
                    <div className="num mt-1 text-6xl text-ink">{formatDayMonth(next.starts_at)}</div>
                  </div>
                  <div className="num text-4xl text-primary">{formatTime(next.starts_at)}</div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-sm text-muted">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{next.location || "Miesto neurčené"}</span>
                  {next.kind === "external" ? <span className="shrink-0">· vs {next.team_b_name}</span> : null}
                  <ChevronRight className="ml-auto size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
              </Link>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
                <div className="flex items-center">
                  <div className="flex -space-x-2">
                    {going.slice(0, 6).map((a) => {
                      const p = lite.get(a.player_id);
                      return p ? (
                        <PlayerAvatar key={p.id} nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" className="rounded-full ring-2 ring-surface" />
                      ) : null;
                    })}
                  </div>
                  <div className="ml-3">
                    <div className="text-sm font-semibold text-ink">
                      <span className="num text-xl">{going.length}</span>
                      {next.max_players ? <span className="text-muted"> / {next.max_players}</span> : null} potvrdených
                    </div>
                    {unanswered > 0 ? <div className="text-xs text-muted">{plural(unanswered, "hráč", "hráči", "hráčov")} bez odpovede</div> : null}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                {signupOpen ? (
                  <RsvpButtons matchId={next.id} current={mine} full={full} />
                ) : (
                  <p className="flex items-center gap-2 rounded-xl bg-bg/50 px-3 py-2.5 text-sm text-muted">
                    <Clock className="size-4" aria-hidden />
                    Prihlasovanie je uzavreté.
                  </p>
                )}
                {signupOpen && next.signup_closes_at ? (
                  <p className="mt-2 text-center text-xs text-muted">Uzávierka o {timeLeft(next.signup_closes_at)}</p>
                ) : null}
              </div>
            </Card>
          ) : activePolls.length > 0 ? null : (
            <EmptyState
              icon={<CalendarPlus />}
              title="Žiadny naplánovaný termín"
              text={me.isAdmin ? "Vytvor termín a partia dostane upozornenie." : "Keď admin vytvorí termín, uvidíš ho tu."}
              action={me.isAdmin ? <ButtonLink href="/terminy?novy=1">Nový termín</ButtonLink> : undefined}
            />
          )}

          {toVote.map((m) => (
            <Link key={m.id} href={`/zapasy/${m.id}`} className="flex items-center gap-3 rounded-card border border-primary/30 bg-primary/[0.07] p-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-bg">
                <Vote className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Hlasuj za MVP zápasu</span>
                <span className="block text-xs text-muted">
                  {formatDayMonth(m.starts_at)} · {m.score_a}:{m.score_b} · ostáva {timeLeft(m.mvp_voting_closes_at!)}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-primary" aria-hidden />
            </Link>
          ))}

          {unresolved.map((m) => (
            <Link key={m.id} href={`/zapasy/${m.id}/vysledok`} className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning/[0.06] p-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <ClipboardPen className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Zapíš výsledok</span>
                <span className="block text-xs text-muted">Termín {formatDayMonth(m.starts_at)} {formatTime(m.starts_at)} ešte nemá výsledok</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-warning" aria-hidden />
            </Link>
          ))}

          {/* Posledný zápas */}
          <div>
            <SectionTitle action={<Link href="/zapasy" className="text-xs font-medium text-primary">Všetky zápasy</Link>}>Posledný zápas</SectionTitle>
            {last ? (
              <MatchCard match={last} mvpName={last.mvp_player_id ? lite.get(last.mvp_player_id)?.nickname : null} />
            ) : (
              <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">Zatiaľ sa neodohral žiadny zápas.</p>
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Lídri sezóny</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
            <Leader label="Najlepší strelec" icon={<Goal aria-hidden />} player={scorer && lite.get(scorer.player_id)} value={scorer?.goals ?? 0} unit={pluralWord(scorer?.goals ?? 0, "gól", "góly", "gólov")} />
            <Leader label="Líder asistencií" icon={<Footprints aria-hidden />} player={assister && lite.get(assister.player_id)} value={assister?.assists ?? 0} unit={pluralWord(assister?.assists ?? 0, "asistencia", "asistencie", "asistencií")} />
            <Leader label="Najviac MVP" icon={<Award aria-hidden />} player={mvp && lite.get(mvp.player_id)} value={mvp?.mvps ?? 0} unit={pluralWord(mvp?.mvps ?? 0, "ocenenie", "ocenenia", "ocenení")} />
          </div>

          <SectionTitle>Partia v číslach</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            <PlayerStat label="Góly partie" value={summary.total_goals} hint={`${plural(summary.matches_played, "zápas", "zápasy", "zápasov")}`} accent />
            <PlayerStat
              label="Priemerná dochádzka"
              value={summary.avg_attendance_pct != null ? `${summary.avg_attendance_pct} %` : "–"}
              hint={summary.avg_players != null ? `ø ${String(summary.avg_players).replace(".", ",")} hráča na zápas` : "zatiaľ bez zápasov"}
            />
            <Link href="/pokladnica" className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-line-strong">
              <div>
                <div className="text-xs font-medium text-muted">Spoločná pokladnica</div>
                <div className="num mt-2 text-[2rem] text-ink">{formatMoney(treasury.cash)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-muted">{treasury.my_debt < 0 ? "Môj preplatok" : "Môj dlh"}</div>
                <div className={`num mt-2 text-2xl ${treasury.my_debt > 0 ? "text-danger" : "text-primary"}`}>{formatMoney(Math.abs(treasury.my_debt))}</div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
