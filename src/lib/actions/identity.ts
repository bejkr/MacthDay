"use server";

import { z } from "zod";
import { describeError, fail, ok, type ActionResult } from "@/lib/errors";
import { act, deviceLabel, ipThrottle, parse, withIdentity } from "./shared";

const nickname = z.string().trim().min(2, "Prezývka musí mať aspoň 2 znaky.").max(24, "Prezývka môže mať najviac 24 znakov.");
const token = z.string().regex(/^[a-f0-9]{64}$/, "Pozývací link je neplatný.");

export type InvitePreview = { valid: boolean; kind?: "group" | "recovery"; groupName?: string; nickname?: string | null };

export async function peekInviteAction(rawToken: string): Promise<ActionResult<InvitePreview>> {
  const parsed = parse(token, rawToken);
  if ("error" in parsed) return ok({ valid: false });
  if (!(await ipThrottle("peek", 30, 10 * 60_000))) return fail("Priveľa pokusov. Skús to o chvíľu.");
  return act<InvitePreview>(async (supabase) => {
    const { data, error } = await supabase.rpc("peek_invite", { p_token: parsed.data });
    if (error) return { error };
    const d = data as { valid: boolean; kind?: "group" | "recovery"; group_name?: string; nickname?: string | null };
    return ok({ valid: d.valid, kind: d.kind, groupName: d.group_name, nickname: d.nickname });
  });
}

export async function joinAction(input: { token: string; nickname?: string }): Promise<ActionResult<{ status: "joined" | "pending" }>> {
  const parsed = parse(z.object({ token, nickname: nickname.optional() }), input);
  if ("error" in parsed) return fail(parsed.error);
  if (!(await ipThrottle("join", 10, 10 * 60_000))) return fail("Priveľa pokusov. Skús to znova o chvíľu.");

  return act<{ status: "joined" | "pending" }>(async (supabase) => {
    const label = await deviceLabel();
    const joined = await withIdentity(supabase, () =>
      supabase.rpc("join_group", { p_token: parsed.data.token, p_nickname: parsed.data.nickname ?? null, p_label: label }),
    );
    if (!joined) return fail(describeError({ message: "no_session" }));
    const { data, error } = joined;
    if (error) return { error };
    const result = data as { status: "joined" | "pending" | "error"; code?: string };
    if (result.status === "error") return fail(describeError({ message: result.code }));
    return ok({ status: result.status });
  });
}

const setupSchema = z.object({
  groupName: z.string().trim().min(2, "Názov partie musí mať aspoň 2 znaky.").max(40, "Názov partie je pridlhý."),
  nickname,
  season: z.string().trim().max(40).optional(),
});

/** Založenie partie + prvý pozývací link. Token sa vráti iba teraz, v DB je už len hash. */
export async function createGroupAction(input: z.input<typeof setupSchema>): Promise<ActionResult<{ token: string }>> {
  const parsed = parse(setupSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  if (!(await ipThrottle("setup", 5, 10 * 60_000))) return fail("Priveľa pokusov. Skús to znova o chvíľu.");

  return act<{ token: string }>(async (supabase) => {
    const label = await deviceLabel();
    const created = await withIdentity(supabase, () =>
      supabase.rpc("create_group", {
        p_name: parsed.data.groupName,
        p_nickname: parsed.data.nickname,
        p_season: parsed.data.season || null,
        p_label: label,
      }),
    );
    if (!created) return fail(describeError({ message: "no_session" }));
    if (created.error) return { error: created.error };
    const invite = await supabase.rpc("create_invite_link", { p_kind: "group" });
    if (invite.error) return { error: invite.error };
    return ok({ token: invite.data });
  });
}

export async function cancelRequestAction(): Promise<ActionResult> {
  return act(async (supabase) => supabase.rpc("cancel_my_request"));
}
