"use server";

import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { act, parse } from "./shared";

const uuid = z.uuid("Neplatný identifikátor.");
const profile = {
  nickname: z.string().trim().min(2, "Prezývka musí mať aspoň 2 znaky.").max(24, "Prezývka môže mať najviac 24 znakov."),
  jerseyNumber: z.number().int().min(0, "Číslo dresu je 0 až 99.").max(99, "Číslo dresu je 0 až 99.").nullable(),
  position: z.enum(["GK", "DEF", "MID", "ATT"]).nullable(),
  skill: z.number().int().min(1).max(5),
};

const createSchema = z.object(profile);

/** Admin môže hráča pripraviť vopred; ten sa potom prihlási svojou prezývkou a admin ho schváli. */
export async function createPlayerAction(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const parsed = parse(createSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const me = await requireMember();
  return act(async (supabase) =>
    supabase.from("players").insert({
      group_id: me.group.id,
      nickname: parsed.data.nickname,
      jersey_number: parsed.data.jerseyNumber,
      position: parsed.data.position,
      skill: parsed.data.skill,
    }),
  );
}

const updateSchema = z.object({
  id: uuid,
  ...profile,
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Neplatná farba."),
  role: z.enum(["admin", "player"]),
  isActive: z.boolean(),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Neplatný dátum."),
});

export async function updatePlayerAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const parsed = parse(updateSchema, input);
  if ("error" in parsed) return fail(parsed.error);
  const v = parsed.data;
  return act(async (supabase) => {
    // Rolu aj všetko ostatné smie zmeniť iba admin – vynucuje to RLS politika
    // players_update_admin; bežnému hráčovi update neprejde (0 riadkov).
    const { data, error } = await supabase
      .from("players")
      .update({
        nickname: v.nickname,
        jersey_number: v.jerseyNumber,
        position: v.position,
        skill: v.skill,
        avatar_color: v.avatarColor,
        role: v.role,
        is_active: v.isActive,
        joined_on: v.joinedOn,
      })
      .eq("id", v.id)
      .select("id");
    if (error) return { error };
    if (!data?.length) return fail("Na túto akciu nemáš oprávnenie.");
    return ok();
  });
}

const MAX_UPLOAD = 900 * 1024;

/**
 * Nahratie avatara. Obrázok sa na serveri vždy nanovo zakóduje (sharp): opraví
 * sa otočenie z mobilu, oreže sa na štvorec 256 px a zahodia sa metadáta aj
 * prípadný skrytý obsah. Do úložiska ide výhradne takto vyrobený JPEG.
 */
export async function uploadAvatarAction(formData: FormData): Promise<ActionResult> {
  const parsedId = parse(uuid, formData.get("playerId"));
  if ("error" in parsedId) return fail(parsedId.error);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Vyber obrázok.");
  if (file.size > MAX_UPLOAD) return fail("Obrázok je príliš veľký.");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return fail("Podporované sú obrázky JPG, PNG a WebP.");

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return fail("Súbor sa nepodarilo spracovať ako obrázok.");
  }

  const me = await requireMember();
  const playerId = parsedId.data;
  const path = `${me.group.id}/${playerId}-${randomBytes(10).toString("hex")}.jpg`;

  return act(async (supabase) => {
    const upload = await supabase.storage.from("avatars").upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (upload.error) return fail("Avatar sa nepodarilo nahrať. Možno na to nemáš oprávnenie.");
    const { data: oldPath, error } = await supabase.rpc("set_avatar", { p_player: playerId, p_path: path });
    if (error) {
      await supabase.storage.from("avatars").remove([path]);
      return { error };
    }
    if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
    return ok();
  });
}

export async function removeAvatarAction(playerId: string): Promise<ActionResult> {
  const parsed = parse(uuid, playerId);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => {
    const { data: oldPath, error } = await supabase.rpc("set_avatar", { p_player: parsed.data, p_path: null });
    if (error) return { error };
    if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
    return ok();
  });
}

export async function removeDeviceAction(deviceId: string): Promise<ActionResult> {
  const parsed = parse(uuid, deviceId);
  if ("error" in parsed) return fail(parsed.error);
  return act(async (supabase) => supabase.from("player_devices").delete().eq("id", parsed.data));
}

/** Jednorazový link (24 h), ktorým si hráč pripojí nové zariadenie bez čakania na schválenie. */
export async function createRecoveryLinkAction(playerId: string): Promise<ActionResult<{ token: string }>> {
  const parsed = parse(uuid, playerId);
  if ("error" in parsed) return fail(parsed.error);
  return act<{ token: string }>(async (supabase) => {
    const { data, error } = await supabase.rpc("create_invite_link", { p_kind: "recovery", p_player: parsed.data });
    return error ? { error } : ok({ token: data });
  });
}
