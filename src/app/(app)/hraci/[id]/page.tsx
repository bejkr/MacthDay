import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Award, ShieldCheck, Star } from "lucide-react";
import { AvatarUploader, DeviceManager, PlayerEditButton } from "@/components/player-admin";
import { PlayerHistoryChart } from "@/components/player-history-chart";
import { parseScope, ScopeTabs } from "@/components/scope-tabs";
import { Badge, Card, CardHeader, PageSkeleton, PlayerStat } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { avatarUrl, getBalances, getPlayer, getPlayerHistory, getStats } from "@/lib/data";
import { formatDate, formatDayMonth, formatPlainDate } from "@/lib/datetime";
import { cn, formatMoney, POSITION_LABEL } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hráč" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ obdobie?: string }> };

async function Profile({ params, searchParams }: Props) {
  const [{ id }, { obdobie }] = await Promise.all([params, searchParams]);
  const me = await requireMember();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const player = await getPlayer(id);
  if (!player) notFound();

  const scope = parseScope(obdobie);
  const seasonId = scope === "sezona" ? (me.season?.id ?? null) : null;
  const isMe = player.id === me.player.id;
  const canSeeMoney = isMe || me.isAdmin;

  const supabase = await createClient();
  const [stats, history, balances, devices, claims] = await Promise.all([
    getStats(seasonId),
    getPlayerHistory(id, seasonId),
    canSeeMoney ? getBalances() : Promise.resolve([]),
    me.isAdmin ? supabase.from("player_devices").select("*").eq("player_id", id).order("created_at") : Promise.resolve({ data: [] }),
    me.isAdmin ? supabase.auth.getClaims() : Promise.resolve(null),
  ]);

  const s = stats.find((row) => row.player_id === id);
  const balance = balances.find((b) => b.playerId === id);
  const myAuthId = claims?.data?.claims?.sub;
  const canEditAvatar = me.isAdmin || (isMe && me.group.allow_avatar_edit);
  const perMatch = s && s.matches_played > 0 ? (s.goals / s.matches_played).toFixed(2).replace(".", ",") : "–";

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <Link href="/hraci" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Hráči
      </Link>

      <Card className="pitch flex items-center gap-4 p-4 sm:p-5">
        <AvatarUploader
          playerId={player.id}
          nickname={player.nickname}
          avatarUrl={avatarUrl(player.avatar_path)}
          color={player.avatar_color}
          jerseyNumber={player.jersey_number}
          canEdit={canEditAvatar}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {player.role === "admin" ? (
              <Badge tone="green">
                <ShieldCheck className="size-3" aria-hidden />
                Admin
              </Badge>
            ) : null}
            {isMe ? <Badge>ty</Badge> : null}
            {!player.is_active ? <Badge tone="danger">Neaktívny</Badge> : null}
          </div>
          <h1 className="display mt-2 truncate text-4xl text-ink">{player.nickname}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {player.position ? POSITION_LABEL[player.position] : "Univerzál"}
            {player.jersey_number != null ? ` · č. ${player.jersey_number}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-0.5" aria-label={`Hodnotenie schopností ${player.skill} z 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={cn("size-4", n <= player.skill ? "fill-warning text-warning" : "text-line-strong")} aria-hidden />
            ))}
          </div>
        </div>
      </Card>

      {me.isAdmin ? (
        <div className="mt-3">
          <PlayerEditButton
            key={player.updated_at}
            initial={{
              id: player.id,
              nickname: player.nickname,
              jerseyNumber: player.jersey_number,
              position: player.position,
              skill: player.skill,
              avatarColor: player.avatar_color,
              role: player.role,
              isActive: player.is_active,
              joinedOn: player.joined_on,
            }}
          />
        </div>
      ) : null}

      <div className="mt-5">
        <ScopeTabs basePath={`/hraci/${player.id}`} scope={scope} seasonName={me.season?.name ?? null} />
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <PlayerStat label="Góly" value={s?.goals ?? 0} accent />
        <PlayerStat label="Asistencie" value={s?.assists ?? 0} />
        <PlayerStat label="MVP" value={s?.mvps ?? 0} />
        <PlayerStat label="Zápasy" value={s?.matches_played ?? 0} hint={s ? `${s.wins}V · ${s.draws}R · ${s.losses}P` : undefined} />
        <PlayerStat label="Dochádzka" value={s?.attendance_pct != null ? `${s.attendance_pct} %` : "–"} hint={s ? `z ${s.eligible_matches} zápasov` : undefined} />
        <PlayerStat label="Góly / zápas" value={perMatch} />
      </div>

      {canSeeMoney && balance ? (
        <Link href="/pokladnica" className="mt-2.5 flex items-center justify-between rounded-2xl border border-line bg-surface p-3.5 hover:border-line-strong">
          <div>
            <div className="text-xs font-medium text-muted">Finančný stav</div>
            <div className="mt-1 text-xs text-muted">
              predpísané {formatMoney(balance.charged)} · zaplatené {formatMoney(balance.paid)}
            </div>
          </div>
          <div className="text-right">
            <div className={cn("num text-2xl", balance.debt > 0 ? "text-danger" : "text-primary")}>{formatMoney(Math.abs(balance.debt))}</div>
            <div className="text-xs text-muted">{balance.debt > 0 ? "dlh" : balance.debt < 0 ? "preplatok" : "vyrovnané"}</div>
          </div>
        </Link>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="História výkonov" />
        {history.length === 0 ? (
          <p className="p-4 text-sm text-muted">V tomto období hráč nenastúpil v žiadnom zápase.</p>
        ) : (
          <>
            <div className="px-3 pt-4">
              <PlayerHistoryChart
                nickname={player.nickname}
                data={history.map((h) => ({ label: formatDayMonth(h.starts_at), goals: h.goals, assists: h.assists }))}
              />
            </div>
            <ul className="mt-2 divide-y divide-line">
              {[...history].reverse().slice(0, 12).map((h) => {
                const own = h.team === "A" ? h.score_a : h.score_b;
                const other = h.team === "A" ? h.score_b : h.score_a;
                const result = own > other ? "V" : own < other ? "P" : "R";
                return (
                  <li key={h.match_id}>
                    <Link href={`/zapasy/${h.match_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50">
                      <span
                        className={cn(
                          "display flex size-7 shrink-0 items-center justify-center rounded-lg text-sm",
                          result === "V" ? "bg-primary/15 text-primary" : result === "P" ? "bg-danger/15 text-danger" : "bg-elevated text-muted",
                        )}
                        aria-label={result === "V" ? "Výhra" : result === "P" ? "Prehra" : "Remíza"}
                      >
                        {result}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">
                          <span className="num text-base">{h.score_a}:{h.score_b}</span>
                          <span className="ml-2 text-muted">{h.team === "A" ? h.team_a_name : h.team_b_name}</span>
                        </span>
                        <span className="block text-xs text-muted">{formatDate(h.starts_at)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-sm">
                        {h.is_mvp ? <Award className="size-4 text-warning" aria-label="MVP" /> : null}
                        {h.goals > 0 ? <span className="font-semibold text-primary">{h.goals} G</span> : null}
                        {h.assists > 0 ? <span className="text-muted">{h.assists} A</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {me.isAdmin ? (
        <Card className="mt-4">
          <CardHeader title="Zariadenia a prístup" />
          <DeviceManager
            playerId={player.id}
            nickname={player.nickname}
            groupName={me.group.name}
            devices={(devices.data ?? []).map((d) => ({
              id: d.id,
              label: d.label,
              createdAt: formatDate(d.created_at),
              lastSeen: formatDate(d.last_seen_at),
              isCurrent: d.auth_user_id === myAuthId,
            }))}
          />
        </Card>
      ) : null}

      <p className="mt-4 text-center text-xs text-muted">V partii od {formatPlainDate(player.joined_on)}</p>
    </div>
  );
}

export default function PlayerPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
