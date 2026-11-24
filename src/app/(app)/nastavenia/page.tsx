import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Download, ShieldCheck } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import {
  AccessRequests, EmailSettings, GroupSettingsForm, InviteManager, NewSeasonButton,
} from "@/components/settings-forms";
import { Badge, Card, CardHeader, PageHeader, PageSkeleton, SectionTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { avatarUrl, getSeasons } from "@/lib/data";
import { formatDate, formatDateTime, formatPlainDate, todayInZone } from "@/lib/datetime";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nastavenia" };

async function Settings() {
  const me = await requireMember();
  const supabase = await createClient();

  const [seasons, contact, requests, invites] = await Promise.all([
    getSeasons(),
    supabase.from("player_contacts").select("*").eq("player_id", me.player.id).maybeSingle(),
    me.isAdmin
      ? supabase.from("access_requests").select("*").eq("status", "pending").order("created_at")
      : Promise.resolve({ data: [] }),
    me.isAdmin
      ? supabase.from("invite_links").select("*").eq("kind", "group").is("revoked_at", null).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  const invite = invites.data?.[0];
  // eslint-disable-next-line react-hooks/purity -- serverový komponent, čas požiadavky
  const now = Date.now();
  const inviteUsable =
    invite && (!invite.expires_at || Date.parse(invite.expires_at) > now) && (invite.max_uses == null || invite.use_count < invite.max_uses);
  const pending = requests.data ?? [];
  const year = todayInZone().slice(0, 4);

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <PageHeader title="Nastavenia" />

      <Link href={`/hraci/${me.player.id}`} className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 hover:border-line-strong">
        <PlayerAvatar nickname={me.player.nickname} avatarUrl={avatarUrl(me.player.avatar_path)} color={me.player.avatar_color} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-ink">{me.player.nickname}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            {me.isAdmin ? (
              <Badge tone="green">
                <ShieldCheck className="size-3" aria-hidden />
                Admin
              </Badge>
            ) : null}
            Môj profil a fotka
          </div>
        </div>
        <ChevronRight className="size-5 text-muted" aria-hidden />
      </Link>

      {me.isAdmin ? (
        <>
          <SectionTitle>Správa partie</SectionTitle>
          <div className="flex flex-col gap-4">
            <Card id="ziadosti" className="scroll-mt-20">
              <CardHeader title="Žiadosti o prístup" action={pending.length > 0 ? <Badge tone="warning">{pending.length}</Badge> : undefined} />
              <AccessRequests
                requests={pending.map((r) => ({ id: r.id, nickname: r.nickname, deviceLabel: r.device_label, createdAt: formatDateTime(r.created_at) }))}
              />
            </Card>

            <Card id="pozvanka" className="scroll-mt-20">
              <CardHeader title="Pozývací link" />
              <InviteManager
                groupName={me.group.name}
                active={
                  invite && inviteUsable
                    ? {
                        id: invite.id,
                        createdAt: formatDate(invite.created_at),
                        useCount: invite.use_count,
                        maxUses: invite.max_uses,
                        expiresAt: invite.expires_at ? formatDate(invite.expires_at) : null,
                      }
                    : null
                }
              />
            </Card>

            <Card id="partia" className="scroll-mt-20">
              <CardHeader title="Partia" />
              <GroupSettingsForm
                key={me.group.updated_at}
                initial={{
                  name: me.group.name,
                  maxPlayers: me.group.max_players,
                  allowAvatarEdit: me.group.allow_avatar_edit,
                  mvpVoteHours: me.group.mvp_vote_hours,
                  rsvpReminderHours: me.group.rsvp_reminder_hours,
                  matchReminderHours: me.group.match_reminder_hours,
                }}
              />
            </Card>
          </div>
        </>
      ) : null}

      <SectionTitle
        action={
          me.isAdmin ? <NewSeasonButton today={todayInZone()} suggestedName={seasons.some((s) => s.name === year) ? `${year} / 2` : year} /> : undefined
        }
      >
        Sezóny
      </SectionTitle>
      <Card id="sezony" className="scroll-mt-20 overflow-hidden">
        <ul className="divide-y divide-line">
          {seasons.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">{s.name}</div>
                <div className="text-xs text-muted">
                  {formatPlainDate(s.starts_on)} – {s.ends_on ? formatPlainDate(s.ends_on) : "prebieha"}
                </div>
              </div>
              {s.is_current ? <Badge tone="green">Aktuálna</Badge> : null}
            </li>
          ))}
          {seasons.length === 0 ? <li className="px-4 py-4 text-sm text-muted">Zatiaľ žiadna sezóna.</li> : null}
        </ul>
      </Card>

      <SectionTitle>Upozornenia e-mailom</SectionTitle>
      <Card id="email" className="scroll-mt-20">
        <EmailSettings
          key={contact.data?.updated_at ?? "none"}
          initialEmail={contact.data?.email ?? ""}
          initialEnabled={contact.data?.email_enabled ?? true}
        />
      </Card>

      <SectionTitle>Aplikácia na ploche</SectionTitle>
      <Card className="flex items-start gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Download className="size-5" aria-hidden />
        </span>
        <div className="text-sm text-muted">
          <p>
            <span className="font-semibold text-ink">iPhone:</span> v Safari ťukni na Zdieľať → Pridať na plochu.
          </p>
          <p className="mt-1.5">
            <span className="font-semibold text-ink">Android:</span> v Chrome otvor menu ⋮ → Pridať na plochu / Inštalovať aplikáciu.
          </p>
          <p className="mt-1.5">Prihlásenie ostane uložené, nič netreba zadávať znova.</p>
        </div>
      </Card>

      <SectionTitle>Súkromie</SectionTitle>
      <Card className="p-4 text-sm leading-relaxed text-muted">
        <p>
          Matchday ukladá iba to, čo partia potrebuje: prezývku, voliteľnú fotku, dochádzku, štatistiky zo zápasov a záznamy pokladnice. E-mail je
          dobrovoľný a vidíš ho iba ty.
        </p>
        <p className="mt-2">
          Toto zariadenie si aplikácia pamätá cez jednu nevyhnutnú cookie s prihlásením. Nepoužívame analytiku, reklamu ani sledovanie tretích strán.
          Ak chceš svoje údaje upraviť alebo zmazať, napíš adminovi partie.
        </p>
      </Card>

      <p className="mt-6 text-center text-xs text-muted/70">Matchday 1.0 · {me.group.name}</p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}
