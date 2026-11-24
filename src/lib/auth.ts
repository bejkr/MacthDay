import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSupabaseEnv } from "./env";
import { describeError } from "./errors";
import { createClient } from "./supabase/server";
import type { Group, Player, Season } from "./supabase/database.types";

export type Me = {
  player: Player;
  group: Group;
  season: Season | null;
  unread: number;
  isAdmin: boolean;
};

export type SessionState =
  | ({ state: "member" } & Me)
  | { state: "pending" | "rejected"; nickname: string; groupName: string }
  | { state: "blocked" | "guest" | "anonymous" | "unconfigured" };

type WhoAmI = {
  state: string;
  player?: Player;
  group?: Group;
  season?: Season | null;
  unread?: number;
  nickname?: string;
  group_name?: string;
};

// Jediné miesto, kde sa zisťuje, kto je na druhej strane. Rolu a partiu určuje
// databáza z overenej session (auth.uid()), nikdy nie údaj poslaný z prehliadača.
export const getSessionState = cache(async (): Promise<SessionState> => {
  // Vždy až pri požiadavke – stav session sa nikdy nesmie "zapiecť" do statickej stránky pri builde.
  await connection();
  if (!getSupabaseEnv()) return { state: "unconfigured" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("whoami");
  if (error) {
    // Bez session beží požiadavka ako rola "anon", ktorá whoami volať nesmie.
    if (error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST302") return { state: "anonymous" };
    throw new Error(describeError(error));
  }
  const who = data as unknown as WhoAmI;
  if (who.state === "member" && who.player && who.group) {
    return {
      state: "member",
      player: who.player,
      group: who.group,
      season: who.season ?? null,
      unread: who.unread ?? 0,
      isAdmin: who.player.role === "admin",
    };
  }
  if (who.state === "pending" || who.state === "rejected") {
    return { state: who.state, nickname: who.nickname ?? "", groupName: who.group_name ?? "" };
  }
  if (who.state === "blocked") return { state: "blocked" };
  return { state: "guest" };
});

export function homeFor(state: SessionState["state"]) {
  switch (state) {
    case "member":
      return "/prehlad";
    case "pending":
    case "rejected":
    case "blocked":
      return "/cakanie";
    case "unconfigured":
      return "/nastavenie-servera";
    default:
      return "/vitaj";
  }
}

export async function requireMember(): Promise<Me> {
  const session = await getSessionState();
  if (session.state !== "member") redirect(homeFor(session.state));
  return session;
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireMember();
  if (!me.isAdmin) redirect("/prehlad");
  return me;
}
