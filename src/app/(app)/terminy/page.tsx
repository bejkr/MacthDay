import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarDays, ChevronRight, ClipboardPen } from "lucide-react";
import { EventFormButton, type EventFormValues } from "@/components/event-form";
import { EventCard } from "@/components/match-card";
import { EmptyState, PageHeader, PageSkeleton, SectionTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getAttendance, getUnresolvedMatches, getUpcomingMatches } from "@/lib/data";
import { formatDate, formatTime, todayInZone } from "@/lib/datetime";

export const metadata: Metadata = { title: "Termíny" };

function defaultEvent(): EventFormValues {
  const tomorrow = new Date(Date.parse(todayInZone()) + 86_400_000).toISOString().slice(0, 10);
  return { startsAt: `${tomorrow}T18:00`, location: "", note: "", maxPlayers: null, signupClosesAt: null, kind: "internal", opponent: "" };
}

async function Events({ searchParams }: { searchParams: Promise<{ novy?: string }> }) {
  const me = await requireMember();
  const [{ novy }, upcoming, unresolved] = await Promise.all([
    searchParams,
    getUpcomingMatches(),
    me.isAdmin ? getUnresolvedMatches() : Promise.resolve([]),
  ]);
  const attendance = await getAttendance(upcoming.map((m) => m.id));

  return (
    <div className="animate-rise">
      <PageHeader
        title="Termíny"
        subtitle="Daj vedieť, či prídeš – stačí jeden ťuk."
        action={me.isAdmin ? <EventFormButton initial={defaultEvent()} defaultOpen={novy === "1"} /> : undefined}
      />

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
          <SectionTitle>Nadchádzajúce</SectionTitle>
        </>
      ) : null}

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
