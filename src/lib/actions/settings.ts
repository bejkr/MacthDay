"use server";

import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { act, parse } from "./shared";

const uuid = z.uuid("Neplatný identifikátor.");
const hours = (min: number, max: number, label: string) =>
  z.number().int().min(min, `${label}: najmenej ${min} h.`).max(max, `${label}: najviac ${max} h.`);

const groupSchema = z.object({
  name: z.string().trim().min(2, "Názov partie musí mať aspoň 2 znaky.").max(40, "Názov partie je pridlhý."),
  maxPlayers: z.number().int().min(2, "Limit hráčov je najmenej 2.").max(100, "Limit hráčov je najviac 100."),
  allowAvatarEdit: z.boolean(),
  mvpVoteHours: hours(1, 168, "Dĺžka hlasovania"),
  rsvpReminderHours: hours(1, 168, "Pripomienka dochádzky"),
  matchReminderHours: hours(1, 72, "Pripomienka zápasu"),
});

export async function updateGroupAction(input: z.input<typeof groupSchema>): Promise<ActionResult> {
  const parsed = parse(groupSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const me = await requireMember();
  return act(async (supabase) => {
    const { data, error } = await supabase
      .from("groups")
      .update({
        name: v.name,
        max_players: v.maxPlayers,
        allow_avatar_edit: v.allowAvatarEdit,
        mvp_vote_hours: v.mvpVoteHours,
        rsvp_reminder_hours: v.rsvpReminderHours,
        match_reminder_hours: v.matchReminderHours,
      })
      .eq("id", me.group.id)
      .select("id");
    if (error) return { error };
    if (!data?.length) return fail("Na túto akciu nemáš oprávnenie.");
    return ok();
  });
}

const seasonSchema = z.object({
  name: z.string().trim().min(1, "Zadaj názov sezóny.").max(40, "Názov sezóny je pridlhý."),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Zadaj dátum začiatku."),
});

export async function startSeasonAction(input: z.input<typeof seasonSchema>): Promise<ActionResult> {
  const parsed = parse(seasonSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("start_new_season", { p_name: parsed.data.name, p_starts_on: parsed.data.startsOn }),
  );
}

const inviteSchema = z.object({
  maxUses: z.number().int().min(1, "Aspoň 1 použitie.").max(200, "Najviac 200 použití."),
  expiresDays: z.number().int().min(1).max(90).nullable(),
});

/** Vygeneruje nový skupinový link a zneplatní predchádzajúci (rotácia). */
export async function createInviteAction(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ token: string }>> {
  const parsed = parse(inviteSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  return act<{ token: string }>(async (supabase) => {
    const { data, error } = await supabase.rpc("create_invite_link", {
      p_kind: "group",
      p_max_uses: parsed.data.maxUses,
      p_expires_hours: parsed.data.expiresDays ? parsed.data.expiresDays * 24 : null,
    });
    return error ? { error } : ok({ token: data });
  });
}

export async function revokeInviteAction(id: string): Promise<ActionResult> {
  const parsed = parse(uuid, id);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.rpc("revoke_invite_link", { p_link: parsed.data }));
}

export async function decideRequestAction(input: { id: string; approve: boolean }): Promise<ActionResult> {
  const parsed = parse(z.object({ id: uuid, approve: z.boolean() }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("decide_access_request", { p_request: parsed.data.id, p_approve: parsed.data.approve }),
  );
}

/**
 * Označí upozornenia ako prečítané BEZ prekreslenia stránky – práve zobrazené
 * položky tak ostanú zvýraznené a počítadlo sa aktualizuje pri ďalšej navigácii.
 */
export async function markNotificationsSeenAction(ids: string[]): Promise<void> {
  const parsed = parse(z.array(uuid).min(1).max(200), ids);
  if ("error" in parsed) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("mark_notifications_read", { p_ids: parsed.data });
  } catch {
    // nie je kritické
  }
}

const emailSchema = z.object({
  email: z.email("Zadaj platnú e-mailovú adresu.").max(254),
  enabled: z.boolean(),
});

/** E-mail je dobrovoľný. Ukladá sa oddelene od profilu a vidí ho iba jeho majiteľ. */
export async function saveEmailAction(input: z.input<typeof emailSchema>): Promise<ActionResult> {
  const parsed = parse(emailSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const me = await requireMember();
  return act(async (supabase) =>
    supabase.from("player_contacts").upsert({
      player_id: me.player.id,
      email: parsed.data.email,
      email_enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
    }),
  );
}

export async function deleteEmailAction(): Promise<ActionResult> {
  const me = await requireMember();
  return act(async (supabase) => supabase.from("player_contacts").delete().eq("player_id", me.player.id));
}
