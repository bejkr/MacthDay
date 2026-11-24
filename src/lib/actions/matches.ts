"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { localInputToIso } from "@/lib/datetime";
import { fail, ok, type ActionResult } from "@/lib/errors";
import type { Json } from "@/lib/supabase/database.types";
import { act, parse } from "./shared";

const uuid = z.uuid("Neplatný identifikátor.");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Zadaj dátum a čas.");
const optionalText = (max: number) => z.string().trim().max(max, `Text môže mať najviac ${max} znakov.`).optional();
const teamName = z.string().trim().min(1, "Zadaj názov tímu.").max(30, "Názov tímu je pridlhý.");

// ───────────── Termíny ─────────────
const eventSchema = z.object({
  id: uuid.optional(),
  startsAt: localDateTime,
  location: optionalText(120),
  note: optionalText(500),
  maxPlayers: z.number().int().min(2, "Minimum sú 2 hráči.").max(60, "Maximum je 60 hráčov.").nullable(),
  signupClosesAt: localDateTime.nullable(),
  kind: z.enum(["internal", "external"]),
  opponent: optionalText(30),
});

export async function saveEventAction(input: z.input<typeof eventSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(eventSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const startsAt = localInputToIso(v.startsAt);
  const closesAt = v.signupClosesAt ? localInputToIso(v.signupClosesAt) : null;
  if (!startsAt) return fail("Zadaj dátum a čas.");
  if (closesAt && closesAt > startsAt) return fail("Uzávierka prihlasovania musí byť pred začiatkom.");
  if (v.kind === "external" && !v.opponent) return fail("Zadaj názov súpera.");

  const me = await requireMember();
  const fields = {
    starts_at: startsAt,
    location: v.location || null,
    note: v.note || null,
    max_players: v.maxPlayers,
    signup_closes_at: closesAt,
    kind: v.kind,
    team_a_name: v.kind === "external" ? me.group.name.slice(0, 30) : "Tím A",
    team_b_name: v.kind === "external" ? v.opponent! : "Tím B",
  };

  return act<{ id: string }>(async (supabase) => {
    if (v.id) {
      const { error } = await supabase.from("matches").update(fields).eq("id", v.id).eq("status", "scheduled");
      return error ? { error } : ok({ id: v.id });
    }
    if (!me.season) return fail("Najprv vytvor sezónu v Nastaveniach.");
    const { data, error } = await supabase
      .from("matches")
      .insert({ ...fields, group_id: me.group.id, season_id: me.season.id, created_by: me.player.id })
      .select("id")
      .single();
    return error ? { error } : ok({ id: data.id });
  });
}

export async function setEventStatusAction(input: { id: string; status: "scheduled" | "cancelled" }): Promise<ActionResult> {
  const parsed = parse(z.object({ id: uuid, status: z.enum(["scheduled", "cancelled"]) }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.from("matches").update({ status: parsed.data.status }).eq("id", parsed.data.id).neq("status", "played"),
  );
}

export async function deleteMatchAction(input: { id: string; redirectTo: "/terminy" | "/zapasy" }): Promise<ActionResult> {
  const parsed = parse(z.object({ id: uuid, redirectTo: z.enum(["/terminy", "/zapasy"]) }), input);
  if ("error" in parsed) return fail(parsed.error);
  const result = await act(async (supabase) => {
    const { data, error } = await supabase.from("matches").delete().eq("id", parsed.data.id).select("id");
    if (error) return { error };
    if (!data?.length) return fail("Na túto akciu nemáš oprávnenie.");
    return ok();
  });
  if (!result.ok) return result;
  // Presmerovanie robí server: zmazaná stránka sa už nesmie znova vykresliť (skončila by ako 404).
  redirect(parsed.data.redirectTo);
}

// ───────────── Dochádzka ─────────────
const status = z.enum(["yes", "no", "maybe"]);

export async function setAttendanceAction(input: { matchId: string; status: "yes" | "no" | "maybe" }): Promise<ActionResult> {
  const parsed = parse(z.object({ matchId: uuid, status }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("set_attendance", { p_match: parsed.data.matchId, p_status: parsed.data.status }),
  );
}

export async function adminSetAttendanceAction(input: {
  matchId: string;
  playerId: string;
  status: "yes" | "no" | "maybe" | null;
}): Promise<ActionResult> {
  const parsed = parse(z.object({ matchId: uuid, playerId: uuid, status: status.nullable() }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("admin_set_attendance", {
      p_match: parsed.data.matchId,
      p_player: parsed.data.playerId,
      p_status: parsed.data.status,
    }),
  );
}

// ───────────── Zostavy ─────────────
const lineupSchema = z.object({
  matchId: uuid,
  teamA: z.array(uuid).max(40),
  teamB: z.array(uuid).max(40),
});

export async function saveLineupAction(input: z.input<typeof lineupSchema>): Promise<ActionResult> {
  const parsed = parse(lineupSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("save_lineup", { p_match: parsed.data.matchId, p_team_a: parsed.data.teamA, p_team_b: parsed.data.teamB }),
  );
}

// ───────────── Výsledok zápasu ─────────────
const side = z.enum(["A", "B"]);
const score = z.number().int().min(0, "Skóre nemôže byť záporné.").max(99, "Skóre je privysoké.");

const resultSchema = z
  .object({
    matchId: uuid.nullable(),
    startsAt: localDateTime.nullable(),
    seasonId: uuid.nullable(),
    location: optionalText(120),
    kind: z.enum(["internal", "external"]),
    teamAName: teamName,
    teamBName: teamName,
    scoreA: score,
    scoreB: score,
    resultNote: optionalText(500),
    mvpMode: z.enum(["vote", "manual", "none"]),
    mvpPlayerId: uuid.nullable(),
    lineup: z.array(z.object({ playerId: uuid, team: side })).min(1, "Pridaj do zostavy aspoň jedného hráča.").max(60),
    goals: z
      .array(z.object({ team: side, scorerId: uuid, assistId: uuid.nullable(), isOwnGoal: z.boolean() }))
      .max(198),
  })
  .refine((v) => v.matchId || v.startsAt, { message: "Zadaj dátum a čas zápasu." })
  .refine((v) => v.mvpMode !== "manual" || v.mvpPlayerId, { message: "Vyber hráča, ktorý bol MVP." });

export async function saveResultAction(input: z.input<typeof resultSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(resultSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const startsAt = v.startsAt ? localInputToIso(v.startsAt) : null;
  if (v.startsAt && !startsAt) return fail("Zadaj dátum a čas zápasu.");

  const payload: Json = {
    ...(startsAt ? { starts_at: startsAt } : {}),
    ...(v.seasonId ? { season_id: v.seasonId } : {}),
    location: v.location ?? "",
    kind: v.kind,
    team_a_name: v.teamAName,
    team_b_name: v.teamBName,
    score_a: v.scoreA,
    score_b: v.scoreB,
    result_note: v.resultNote ?? "",
    mvp_mode: v.mvpMode,
    mvp_player_id: v.mvpMode === "manual" ? v.mvpPlayerId : null,
    lineup: v.lineup.map((l) => ({ player_id: l.playerId, team: l.team })),
    goals: v.goals.map((g) => ({
      team: g.team,
      scorer_id: g.scorerId,
      assist_id: g.isOwnGoal ? null : g.assistId,
      is_own_goal: g.isOwnGoal,
    })),
  };

  return act<{ id: string }>(async (supabase) => {
    const { data, error } = await supabase.rpc("save_match_result", { p_match: v.matchId, p: payload });
    return error ? { error } : ok({ id: data });
  });
}

// ───────────── MVP ─────────────
export async function castVoteAction(input: { matchId: string; candidateId: string }): Promise<ActionResult> {
  const parsed = parse(z.object({ matchId: uuid, candidateId: uuid }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) =>
    supabase.rpc("cast_mvp_vote", { p_match: parsed.data.matchId, p_candidate: parsed.data.candidateId }),
  );
}
