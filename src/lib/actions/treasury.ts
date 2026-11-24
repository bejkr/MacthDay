"use server";

import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/errors";
import { act, parse } from "./shared";

const uuid = z.uuid("Neplatný identifikátor.");

const entrySchema = z
  .object({
    type: z.enum(["fine", "payment", "contribution", "expense", "income"]),
    playerId: uuid.nullable(),
    // Suma sa vždy zadáva kladná; smer (dlh / hotovosť) určuje typ transakcie v databáze.
    amount: z.number().positive("Suma musí byť väčšia ako 0.").max(100000, "Suma je privysoká.").multipleOf(0.01, "Suma môže mať najviac 2 desatinné miesta."),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Zadaj dátum."),
    note: z.string().trim().max(300, "Poznámka môže mať najviac 300 znakov.").optional(),
  })
  .refine((v) => !["fine", "payment", "contribution"].includes(v.type) || v.playerId, { message: "Vyber hráča." });

export async function addTreasuryEntryAction(input: z.input<typeof entrySchema>): Promise<ActionResult> {
  const parsed = parse(entrySchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  const me = await requireMember();
  return act(async (supabase) =>
    supabase.from("treasury_entries").insert({
      group_id: me.group.id,
      player_id: v.type === "expense" ? null : v.playerId,
      type: v.type,
      amount: v.amount,
      entry_date: v.entryDate,
      note: v.note || null,
      created_by: me.player.id,
    }),
  );
}

export async function deleteTreasuryEntryAction(id: string): Promise<ActionResult> {
  const parsed = parse(uuid, id);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.from("treasury_entries").delete().eq("id", parsed.data));
}
