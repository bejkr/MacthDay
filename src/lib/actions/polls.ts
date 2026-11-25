"use server";

import { z } from "zod";
import { localInputToIso } from "@/lib/datetime";
import { fail, ok, type ActionResult } from "@/lib/errors";
import type { Json } from "@/lib/supabase/database.types";
import { act, parse } from "./shared";

const uuid = z.uuid("Neplatný identifikátor.");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Zadaj dátum a čas.");

const createSchema = z.object({
  title: z.string().trim().min(2, "Otázka musí mať aspoň 2 znaky.").max(100, "Otázka je pridlhá."),
  note: z.string().trim().max(300, "Poznámka môže mať najviac 300 znakov.").optional(),
  allowMultiple: z.boolean(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Každá možnosť musí mať text.").max(80, "Možnosť môže mať najviac 80 znakov."),
        startsAt: localDateTime.nullable(),
      }),
    )
    .min(2, "Pridaj aspoň 2 možnosti.")
    .max(10, "Najviac 10 možností."),
});

/** Anketu môže vytvoriť ktorýkoľvek člen partie; ostatní dostanú upozornenie. */
export async function createPollAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(createSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const options: Json = v.options.map((o) => ({ label: o.label, starts_at: o.startsAt ? localInputToIso(o.startsAt) : null }));
  return act<{ id: string }>(async (supabase) => {
    const { data, error } = await supabase.rpc("create_poll", {
      p_title: v.title,
      p_note: v.note || null,
      p_options: options,
      p_allow_multiple: v.allowMultiple,
    });
    return error ? { error } : ok({ id: data });
  });
}

/** Nastaví moje hlasy v ankete (prázdne pole = zrušiť hlasovanie). */
export async function votePollAction(input: { pollId: string; optionIds: string[] }): Promise<ActionResult> {
  const parsed = parse(z.object({ pollId: uuid, optionIds: z.array(uuid).max(10) }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.rpc("vote_poll", { p_poll: parsed.data.pollId, p_options: parsed.data.optionIds }));
}

export async function setPollOpenAction(input: { pollId: string; open: boolean }): Promise<ActionResult> {
  const parsed = parse(z.object({ pollId: uuid, open: z.boolean() }), input);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.rpc("set_poll_open", { p_poll: parsed.data.pollId, p_open: parsed.data.open }));
}

export async function deletePollAction(pollId: string): Promise<ActionResult> {
  const parsed = parse(uuid, pollId);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.rpc("delete_poll", { p_poll: parsed.data }));
}

const convertSchema = z.object({
  pollId: uuid,
  optionId: uuid,
  startsAt: localDateTime,
  location: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  maxPlayers: z.number().int().min(2, "Minimum sú 2 hráči.").max(60, "Maximum je 60 hráčov.").nullable(),
  signupClosesAt: localDateTime.nullable(),
  kind: z.enum(["internal", "external"]),
  opponent: z.string().trim().max(30).optional(),
  markAttendance: z.boolean(),
});

/** Admin: z vybranej možnosti ankety vytvorí pevný termín. */
export async function createEventFromPollAction(input: z.input<typeof convertSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(convertSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const startsAt = localInputToIso(v.startsAt);
  const closesAt = v.signupClosesAt ? localInputToIso(v.signupClosesAt) : null;
  if (!startsAt) return fail("Zadaj dátum a čas.");
  if (closesAt && closesAt > startsAt) return fail("Uzávierka prihlasovania musí byť pred začiatkom.");
  if (v.kind === "external" && !v.opponent) return fail("Zadaj názov súpera.");

  const payload: Json = {
    starts_at: startsAt,
    location: v.location ?? "",
    note: v.note ?? "",
    max_players: v.maxPlayers,
    signup_closes_at: closesAt,
    kind: v.kind,
    team_b_name: v.kind === "external" ? (v.opponent ?? "") : "",
    mark_attendance: v.markAttendance,
  };
  return act<{ id: string }>(async (supabase) => {
    const { data, error } = await supabase.rpc("create_event_from_poll", { p_poll: v.pollId, p_option: v.optionId, p: payload });
    return error ? { error } : ok({ id: data });
  });
}
