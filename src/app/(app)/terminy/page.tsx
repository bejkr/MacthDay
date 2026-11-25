import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarDays, ChevronRight, ClipboardPen } from "lucide-react";
import { EventFormButton } from "@/components/event-form";
import { EventCard } from "@/components/match-card";
import { PollCard } from "@/components/poll-card";
import { PollCreateButton } from "@/components/poll-create";
import { EmptyState, PageHeader, PageSkeleton, SectionTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getAttendance, getPlayers, getPolls, getUnresolvedMatches, getUpcomingMatches, toLite } from "@/lib/data";
import { formatDate, formatTime } from "@/lib/datetime";
import { defaultEventValues } from "@/lib/event-defaults";

export const metadata: Metadata = { title: "Termíny" };

async function Events({ searchParams }: { searchParams: Promise<{ novy?: string }> }) {
  const me = await requireMember();
  const [{ novy }, upcoming, unresolved, polls, players] = await Promise.all([
    searchParams,
    getUpcomingMatches(),
    me.isAdmin ? getUnresolvedMatches() : Promise.resolve([]),
    getPolls(),
    getPlayers(),
  ]);
  const playersById = Object.fromEntries(players.map((p) => [p.id, toLite(p)]));
  const eventDefaults = defaultEventValues();
  const attendance = await getAttendance(upcoming.map((m) => m.id));

  return (
    <div className="animate-rise">
      <PageHeader
        title="Termíny"
        subtitle="Daj vedieť, či prídeš – stačí jeden ťuk."
        action={me.isAdmin ? <EventFormButton initial={eventDefaults} defaultOpen={novy === "1"} /> : undefined}
      />

      <SectionTitle action={<PollCreateButton />}>Ankety</SectionTitle>
      {polls.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-5 text-center text-sm text-muted">
          Ešte nie je dohodnutý termín? Vytvor anketu a nechaj partiu hlasovať.
        </p>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {polls.map((poll) => (
            <PollCard key={poll.id} poll={poll} players={playersById} meId={me.player.id} isAdmin={me.isAdmin} defaultEvent={eventDefaults} />
          ))}
        </div>
      )}

      {unresolved.length > 0 ? (
        <>
          <SectionTitle>Čaká na výsledok</SectionTitle>
          <div className="flex flex-col gap-2.5">
            {unresolved.map((m) => (
              <Link key={m.id} href={`/zapasy/${m.id}/vysledok`} className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning/[0.06] p-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <ClipboardPen className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{formatDate(m.starts_at)} · {formatTime(m.starts_at)}</span>
                  <span className="block truncate text-xs text-muted">{m.location || "Miesto neurčené"} — zapíš výsledok</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-warning" aria-hidden />
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle>Nadchádzajúce termíny</SectionTitle>

      {upcoming.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Nič naplánované"
          text={me.isAdmin ? "Vytvor prvý termín tlačidlom hore." : "Keď admin vytvorí termín, príde ti upozornenie."}
        />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {upcoming.map((m) => {
            const rows = attendance.filter((a) => a.match_id === m.id);
            return (
              <EventCard
                key={m.id}
                match={m}
                yesCount={rows.filter((a) => a.status === "yes").length}
                myStatus={rows.find((a) => a.player_id === me.player.id)?.status ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EventsPage(props: { searchParams: Promise<{ novy?: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Events searchParams={props.searchParams} />
    </Suspense>
  );
}
