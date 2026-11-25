import "server-only";
import { getSupabaseEnv } from "./env";
import { describeError } from "./errors";
import { createClient } from "./supabase/server";
import type {
  Attendance, Enum, Goal, LineupRow, Match, Notification, Player, PlayerHistoryRow,
  PlayerStats, Season, TreasuryEntry,
} from "./supabase/database.types";

// Všetky čítania idú cez tento súbor. Každý dotaz beží so session používateľa,
// takže viditeľnosť údajov určuje RLS v databáze – tu sa nič nefiltruje "na dôveru".

async function unwrap<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(describeError(error));
  return data as T;
}

/** Hráč v tvare bezpečnom na poslanie do klientskych komponentov. */
export type PlayerLite = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  avatarColor: string;
  jerseyNumber: number | null;
  position: Enum<"player_position"> | null;
  skill: number;
  isActive: boolean;
  /** Zmazaný (anonymizovaný) hráč – v histórii ostáva, inde sa nezobrazuje. */
  isDeleted: boolean;
  role: Enum<"player_role">;
};

export function avatarUrl(path: string | null) {
  const env = getSupabaseEnv();
  if (!path || !env) return null;
  return `${env.url}/storage/v1/object/public/avatars/${path}`;
}

export const toLite = (p: Player): PlayerLite => ({
  id: p.id,
  nickname: p.nickname,
  avatarUrl: avatarUrl(p.avatar_path),
  avatarColor: p.avatar_color,
  jerseyNumber: p.jersey_number,
  position: p.position,
  skill: p.skill,
  isActive: p.is_active,
  isDeleted: !!p.deleted_at,
  role: p.role,
});

export async function getPlayers(): Promise<Player[]> {
  const supabase = await createClient();
  const players = await unwrap(supabase.from("players").select("*"));
  return players.sort((a, b) => a.nickname.localeCompare(b.nickname, "sk"));
}

export async function getPlayer(id: string): Promise<Player | null> {
  const supabase = await createClient();
  return unwrap(supabase.from("players").select("*").eq("id", id).maybeSingle());
}

export async function getStats(seasonId: string | null): Promise<PlayerStats[]> {
  const supabase = await createClient();
  return unwrap(supabase.rpc("player_stats", { p_season: seasonId }));
}

export async function getPlayerHistory(playerId: string, seasonId: string | null): Promise<PlayerHistoryRow[]> {
  const supabase = await createClient();
  return unwrap(supabase.rpc("player_history", { p_player: playerId, p_season: seasonId }));
}

export type GroupSummary = {
  matches_played: number;
  total_goals: number;
  avg_players: number | null;
  avg_attendance_pct: number | null;
};

export async function getGroupSummary(seasonId: string | null): Promise<GroupSummary> {
  const supabase = await createClient();
  return (await unwrap(supabase.rpc("group_summary", { p_season: seasonId }))) as unknown as GroupSummary;
}

export async function getSeasons(): Promise<Season[]> {
  const supabase = await createClient();
  return unwrap(supabase.from("seasons").select("*").order("starts_on", { ascending: false }));
}

export async function getUpcomingMatches(limit = 30): Promise<Match[]> {
  const supabase = await createClient();
  // Termín ostáva "nadchádzajúci" ešte 6 hodín po začiatku, kým admin nezapíše výsledok.
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  return unwrap(
    supabase.from("matches").select("*").in("status", ["scheduled", "cancelled"]).gte("starts_at", since)
      .order("starts_at", { ascending: true }).limit(limit),
  );
}

/** Termíny, ktoré už prebehli, ale nemajú zapísaný výsledok (pre admina). */
export async function getUnresolvedMatches(): Promise<Match[]> {
  const supabase = await createClient();
  const until = new Date(Date.now() - 6 * 3_600_000).toISOString();
  return unwrap(
    supabase.from("matches").select("*").eq("status", "scheduled").lt("starts_at", until)
      .order("starts_at", { ascending: false }).limit(10),
  );
}

export async function getPlayedMatches(seasonId: string | null, limit = 100): Promise<Match[]> {
  const supabase = await createClient();
  let query = supabase.from("matches").select("*").eq("status", "played");
  if (seasonId) query = query.eq("season_id", seasonId);
  return unwrap(query.order("starts_at", { ascending: false }).limit(limit));
}

export async function getMatch(id: string): Promise<Match | null> {
  const supabase = await createClient();
  return unwrap(supabase.from("matches").select("*").eq("id", id).maybeSingle());
}

export async function getAttendance(matchIds: string[]): Promise<Attendance[]> {
  if (matchIds.length === 0) return [];
  const supabase = await createClient();
  return unwrap(supabase.from("attendance").select("*").in("match_id", matchIds));
}

export async function getLineups(matchIds: string[]): Promise<LineupRow[]> {
  if (matchIds.length === 0) return [];
  const supabase = await createClient();
  return unwrap(supabase.from("match_player_stats").select("*").in("match_id", matchIds));
}

export async function getGoals(matchIds: string[]): Promise<Goal[]> {
  if (matchIds.length === 0) return [];
  const supabase = await createClient();
  return unwrap(supabase.from("match_goals").select("*").in("match_id", matchIds).order("seq"));
}

export type MvpStatus = {
  mode: Enum<"mvp_mode">;
  closed: boolean;
  closes_at: string | null;
  eligible: boolean;
  my_vote: string | null;
  votes_cast: number;
  voters: number;
  tally: { player_id: string; votes: number }[] | null;
};

export async function getMvpStatus(matchId: string): Promise<MvpStatus> {
  const supabase = await createClient();
  return (await unwrap(supabase.rpc("mvp_status", { p_match: matchId }))) as unknown as MvpStatus;
}

export type TreasurySummary = { cash: number; outstanding: number; my_debt: number };

export async function getTreasurySummary(): Promise<TreasurySummary> {
  const supabase = await createClient();
  const s = (await unwrap(supabase.rpc("treasury_summary"))) as unknown as Record<keyof TreasurySummary, number | string>;
  return { cash: Number(s.cash), outstanding: Number(s.outstanding), my_debt: Number(s.my_debt) };
}

export async function getBalances() {
  const supabase = await createClient();
  const rows = await unwrap(supabase.rpc("player_balances"));
  return rows.map((r) => ({ playerId: r.player_id, charged: Number(r.charged), paid: Number(r.paid), debt: Number(r.debt) }));
}

export async function getTreasuryEntries(limit = 200): Promise<TreasuryEntry[]> {
  const supabase = await createClient();
  const rows = await unwrap(
    supabase.from("treasury_entries").select("*")
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit),
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function getNotifications(limit = 60): Promise<Notification[]> {
  const supabase = await createClient();
  return unwrap(supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(limit));
}

export type PollView = {
  id: string;
  title: string;
  note: string | null;
  allowMultiple: boolean;
  status: "open" | "closed" | "converted";
  /** Dá sa ešte hlasovať (otvorená a neuplynul koniec hlasovania). */
  votingOpen: boolean;
  matchId: string | null;
  createdBy: string | null;
  createdAt: string;
  options: { id: string; label: string; startsAt: string | null; voters: string[] }[];
};

/** Ankety partie: otvorené a uzavreté; vybavené (s termínom) iba z posledných 14 dní. */
export async function getPolls(): Promise<PollView[]> {
  const supabase = await createClient();
  const polls = await unwrap(supabase.from("polls").select("*").order("created_at", { ascending: false }).limit(30));
  const now = Date.now();
  const visible = polls.filter((p) => p.status !== "converted" || Date.parse(p.created_at) > now - 14 * 86_400_000);
  if (visible.length === 0) return [];
  const ids = visible.map((p) => p.id);
  const [options, votes] = await Promise.all([
    unwrap(supabase.from("poll_options").select("*").in("poll_id", ids).order("position")),
    unwrap(supabase.from("poll_votes").select("*").in("poll_id", ids).order("created_at")),
  ]);
  return visible.map((p) => ({
    id: p.id,
    title: p.title,
    note: p.note,
    allowMultiple: p.allow_multiple,
    status: p.status,
    votingOpen: p.status === "open" && (!p.closes_at || Date.parse(p.closes_at) > now),
    matchId: p.match_id,
    createdBy: p.created_by,
    createdAt: p.created_at,
    options: options
      .filter((o) => o.poll_id === p.id)
      .map((o) => ({
        id: o.id,
        label: o.label,
        startsAt: o.starts_at,
        voters: votes.filter((v) => v.option_id === o.id).map((v) => v.player_id),
      })),
  }));
}

/** Poistka k pg_cron: uzavrie skončené MVP hlasovania a vytvorí splatné pripomienky. */
export async function tick() {
  try {
    const supabase = await createClient();
    await supabase.rpc("tick");
  } catch {
    // nie je kritické – nabudúce
  }
}

export function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r]));
}
