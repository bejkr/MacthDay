import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ClipboardPen, Clock, MapPin, StickyNote, Users } from "lucide-react";
import { RsvpButtons } from "@/components/attendance";
import { AttendanceEditor, CancelEventButton, DeleteMatchButton } from "@/components/event-admin";
import { EventFormButton } from "@/components/event-form";
import { Lineups } from "@/components/lineups";
import { PlayerAvatar } from "@/components/player-avatar";
import { TeamBuilder } from "@/components/team-builder";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageSkeleton } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { getAttendance, getLineups, getMatch, getPlayers, toLite, type PlayerLite } from "@/lib/data";
import { formatDateTime, formatDayMonth, formatTime, formatWeekday, isoToLocalInput, relativeDay, timeLeft } from "@/lib/datetime";
import { cn } from "@/lib/format";
import type { Enum } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Termín" };

type Status = Enum<"attendance_status">;

function Group({ title, players, tone }: { title: string; players: PlayerLite[]; tone: string }) {
  if (players.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("size-2 rounded-full", tone)} aria-hidden />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="num text-base text-muted">{players.length}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((p) => (
          <li key={p.id}>
            <Link href={`/hraci/${p.id}`} className="flex items-center gap-1.5 rounded-full border border-line bg-bg/50 py-1 pr-3 pl-1 text-sm text-ink hover:border-line-strong">
              <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="xs" />
              {p.nickname}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function EventDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const match = await getMatch(id);
  if (!match) notFound();
  if (match.status === "played") redirect(`/zapasy/${match.id}`);

  const [players, attendance, lineup] = await Promise.all([getPlayers(), getAttendance([id]), getLineups([id])]);
  const lite = players.map(toLite);
  const statusOf: Record<string, Status | undefined> = Object.fromEntries(attendance.map((a) => [a.player_id, a.status]));
  // Zobrazujeme aktívnych hráčov + neaktívnych, ktorí na tento termín odpovedali.
  const relevant = lite.filter((p) => p.isActive || statusOf[p.id]);
  const by = (s: Status | undefined) => relevant.filter((p) => statusOf[p.id] === s);
  const going = by("yes");

  const cancelled = match.status === "cancelled";
  const deadline = match.signup_closes_at ?? match.starts_at;
  // eslint-disable-next-line react-hooks/purity -- serverový komponent, čas požiadavky
  const now = Date.now();
  const open = !cancelled && now < Date.parse(deadline);
  const started = now >= Date.parse(match.starts_at);
  const full = match.max_players != null && going.length >= match.max_players;
  const external = match.kind === "external";

  const savedA = lineup.filter((l) => l.team === "A").map((l) => l.player_id);
  const savedB = lineup.filter((l) => l.team === "B").map((l) => l.player_id);
  const pick = (ids: string[]) => ids.map((pid) => lite.find((p) => p.id === pid)).filter((p): p is PlayerLite => !!p);

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <Link href="/terminy" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Termíny
      </Link>

      <Card className="pitch p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow !text-primary">{external ? `Zápas vs ${match.team_b_name}` : "Termín"}</span>
          {cancelled ? <Badge tone="danger">Zrušené</Badge> : <Badge tone="solid">{relativeDay(match.starts_at)}</Badge>}
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-sm text-muted capitalize">{formatWeekday(match.starts_at)}</div>
            <h1 className="num mt-1 text-6xl text-ink">{formatDayMonth(match.starts_at)}</h1>
          </div>
          <div className="num text-4xl text-primary">{formatTime(match.starts_at)}</div>
        </div>
        <dl className="mt-4 flex flex-col gap-2 text-sm text-muted">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0" aria-hidden />
            <dt className="sr-only">Miesto</dt>
            <dd>{match.location || "Miesto neurčené"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 shrink-0" aria-hidden />
            <dt className="sr-only">Potvrdení</dt>
            <dd>
              <span className="font-semibold text-ink">{going.length}</span>
              {match.max_players ? ` z ${match.max_players}` : ""} potvrdených
              {full ? <span className="ml-2 font-semibold text-warning">plno</span> : null}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 shrink-0" aria-hidden />
            <dt className="sr-only">Uzávierka</dt>
            <dd>
              {open
                ? match.signup_closes_at
                  ? `Prihlasovanie do ${formatDateTime(match.signup_closes_at)} (ostáva ${timeLeft(match.signup_closes_at)})`
                  : "Prihlasovanie do začiatku"
                : "Prihlasovanie je uzavreté"}
            </dd>
          </div>
          {match.note ? (
            <div className="flex items-start gap-2">
              <StickyNote className="mt-0.5 size-4 shrink-0" aria-hidden />
              <dt className="sr-only">Poznámka</dt>
              <dd className="whitespace-pre-line text-ink/90">{match.note}</dd>
            </div>
          ) : null}
        </dl>

        {!cancelled ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-sm font-medium text-ink">Prídeš?</p>
            <RsvpButtons matchId={match.id} current={statusOf[me.player.id] ?? null} disabled={!open} full={full} />
          </div>
        ) : null}
      </Card>

      {me.isAdmin && started && !cancelled ? (
        <ButtonLink href={`/zapasy/${match.id}/vysledok`} size="lg" className="mt-4 w-full" icon={<ClipboardPen className="size-5" aria-hidden />}>
          Zapísať výsledok
        </ButtonLink>
      ) : null}

      <Card className="mt-4">
        <CardHeader
          title="Dochádzka"
          action={me.isAdmin ? <AttendanceEditor matchId={match.id} players={relevant} statuses={statusOf} /> : undefined}
        />
        <div className="flex flex-col gap-4 p-4">
          <Group title="Prídu" players={going} tone="bg-primary" />
          <Group title="Možno" players={by("maybe")} tone="bg-warning" />
          <Group title="Neprídu" players={by("no")} tone="bg-danger" />
          <Group title="Bez odpovede" players={by(undefined)} tone="bg-muted" />
        </div>
      </Card>

      {!cancelled && !external ? (
        <Card className="mt-4">
          <CardHeader title="Tímy" />
          <div className="pt-3">
            {me.isAdmin ? (
              <TeamBuilder
                key={going.map((p) => p.id).join(",")}
                matchId={match.id}
                players={going}
                saved={{ a: savedA, b: savedB }}
                teamAName={match.team_a_name}
                teamBName={match.team_b_name}
              />
            ) : lineup.length > 0 ? (
              <div className="px-4 pb-4">
                <Lineups teamAName={match.team_a_name} teamBName={match.team_b_name} teamA={pick(savedA)} teamB={pick(savedB)} />
              </div>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted">Admin zatiaľ tímy nerozdelil.</p>
            )}
          </div>
        </Card>
      ) : null}

      {me.isAdmin ? (
        <div className="mt-5 flex flex-wrap gap-2.5 [&>*]:flex-none">
          {!cancelled ? (
            <EventFormButton
              variant="edit"
              initial={{
                id: match.id,
                startsAt: isoToLocalInput(match.starts_at),
                location: match.location ?? "",
                note: match.note ?? "",
                maxPlayers: match.max_players,
                signupClosesAt: match.signup_closes_at ? isoToLocalInput(match.signup_closes_at) : null,
                kind: match.kind,
                opponent: external ? match.team_b_name : "",
              }}
            />
          ) : null}
          {!started || cancelled ? <CancelEventButton matchId={match.id} cancelled={cancelled} /> : null}
          {!started && !cancelled ? (
            <ButtonLink href={`/zapasy/${match.id}/vysledok`} variant="secondary" icon={<ClipboardPen className="size-4" aria-hidden />}>
              Zapísať výsledok
            </ButtonLink>
          ) : null}
          <DeleteMatchButton matchId={match.id} redirectTo="/terminy" />
        </div>
      ) : null}
    </div>
  );
}

export default function EventPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventDetail params={props.params} />
    </Suspense>
  );
}
