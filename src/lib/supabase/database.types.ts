// Typy databázy v tvare, aký generuje Supabase CLI.
// Po zmene migrácií pregeneruj:  npm run db:types
// (vyžaduje bežiaci lokálny Supabase alebo prepojený projekt).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableDef<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      groups: TableDef<
        {
          id: string;
          name: string;
          max_players: number;
          allow_avatar_edit: boolean;
          mvp_vote_hours: number;
          rsvp_reminder_hours: number;
          match_reminder_hours: number;
          currency: string;
          created_at: string;
          updated_at: string;
        },
        "name"
      >;
      players: TableDef<
        {
          id: string;
          group_id: string;
          nickname: string;
          nickname_key: string;
          role: Database["public"]["Enums"]["player_role"];
          jersey_number: number | null;
          position: Database["public"]["Enums"]["player_position"] | null;
          skill: number;
          avatar_path: string | null;
          avatar_color: string;
          is_active: boolean;
          joined_on: string;
          created_at: string;
          updated_at: string;
        },
        "group_id" | "nickname"
      >;
      player_devices: TableDef<
        {
          id: string;
          player_id: string;
          auth_user_id: string;
          label: string | null;
          created_at: string;
          last_seen_at: string;
        },
        "player_id" | "auth_user_id"
      >;
      player_contacts: TableDef<
        { player_id: string; email: string; email_enabled: boolean; updated_at: string },
        "player_id" | "email"
      >;
      invite_links: TableDef<
        {
          id: string;
          group_id: string;
          kind: Database["public"]["Enums"]["invite_kind"];
          player_id: string | null;
          token_hash: string;
          max_uses: number | null;
          use_count: number;
          expires_at: string | null;
          revoked_at: string | null;
          created_by: string | null;
          created_at: string;
        },
        "group_id" | "token_hash"
      >;
      access_requests: TableDef<
        {
          id: string;
          group_id: string;
          player_id: string;
          auth_user_id: string;
          nickname: string;
          device_label: string | null;
          status: Database["public"]["Enums"]["request_status"];
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        },
        "group_id" | "player_id" | "auth_user_id" | "nickname"
      >;
      seasons: TableDef<
        {
          id: string;
          group_id: string;
          name: string;
          starts_on: string;
          ends_on: string | null;
          is_current: boolean;
          created_at: string;
        },
        "group_id" | "name"
      >;
      matches: TableDef<
        {
          id: string;
          group_id: string;
          season_id: string;
          status: Database["public"]["Enums"]["match_status"];
          kind: Database["public"]["Enums"]["match_kind"];
          starts_at: string;
          location: string | null;
          note: string | null;
          max_players: number | null;
          signup_closes_at: string | null;
          team_a_name: string;
          team_b_name: string;
          score_a: number | null;
          score_b: number | null;
          result_note: string | null;
          mvp_mode: Database["public"]["Enums"]["mvp_mode"];
          mvp_player_id: string | null;
          mvp_voting_closes_at: string | null;
          mvp_finalized_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
        "group_id" | "season_id" | "starts_at"
      >;
      attendance: TableDef<
        {
          id: string;
          match_id: string;
          player_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        },
        "match_id" | "player_id" | "status"
      >;
      match_player_stats: TableDef<
        {
          id: string;
          match_id: string;
          player_id: string;
          team: Database["public"]["Enums"]["team_side"];
          created_at: string;
        },
        "match_id" | "player_id" | "team"
      >;
      match_goals: TableDef<
        {
          id: string;
          match_id: string;
          team: Database["public"]["Enums"]["team_side"];
          scorer_id: string;
          assist_id: string | null;
          is_own_goal: boolean;
          seq: number;
          created_at: string;
        },
        "match_id" | "team" | "scorer_id"
      >;
      mvp_votes: TableDef<
        { id: string; match_id: string; voter_id: string; candidate_id: string; created_at: string },
        "match_id" | "voter_id" | "candidate_id"
      >;
      treasury_entries: TableDef<
        {
          id: string;
          group_id: string;
          player_id: string | null;
          type: Database["public"]["Enums"]["treasury_type"];
          amount: number;
          entry_date: string;
          note: string | null;
          created_by: string;
          created_at: string;
        },
        "group_id" | "type" | "amount" | "created_by"
      >;
      notifications: TableDef<
        {
          id: string;
          group_id: string;
          player_id: string;
          type: Database["public"]["Enums"]["notification_type"];
          title: string;
          body: string | null;
          link: string | null;
          dedupe_key: string | null;
          read_at: string | null;
          emailed_at: string | null;
          created_at: string;
        },
        "group_id" | "player_id" | "type" | "title"
      >;
    };
    Views: Record<never, never>;
    Functions: {
      whoami: { Args: Record<PropertyKey, never>; Returns: Json };
      setup_open: { Args: Record<PropertyKey, never>; Returns: boolean };
      create_group: {
        Args: { p_name: string; p_nickname: string; p_season: string | null; p_label?: string | null };
        Returns: string;
      };
      peek_invite: { Args: { p_token: string }; Returns: Json };
      join_group: { Args: { p_token: string; p_nickname: string | null; p_label?: string | null }; Returns: Json };
      cancel_my_request: { Args: Record<PropertyKey, never>; Returns: undefined };
      decide_access_request: { Args: { p_request: string; p_approve: boolean }; Returns: undefined };
      create_invite_link: {
        Args: { p_kind?: string; p_player?: string | null; p_max_uses?: number; p_expires_hours?: number | null };
        Returns: string;
      };
      revoke_invite_link: { Args: { p_link: string }; Returns: undefined };
      set_avatar: { Args: { p_player: string; p_path: string | null }; Returns: string | null };
      start_new_season: { Args: { p_name: string; p_starts_on?: string }; Returns: string };
      set_attendance: {
        Args: { p_match: string; p_status: Database["public"]["Enums"]["attendance_status"] };
        Returns: undefined;
      };
      admin_set_attendance: {
        Args: { p_match: string; p_player: string; p_status: Database["public"]["Enums"]["attendance_status"] | null };
        Returns: undefined;
      };
      save_lineup: { Args: { p_match: string; p_team_a: string[]; p_team_b: string[] }; Returns: undefined };
      save_match_result: { Args: { p_match: string | null; p: Json }; Returns: string };
      cast_mvp_vote: { Args: { p_match: string; p_candidate: string }; Returns: undefined };
      mvp_status: { Args: { p_match: string }; Returns: Json };
      player_stats: {
        Args: { p_season?: string | null };
        Returns: {
          player_id: string;
          matches_played: number;
          goals: number;
          assists: number;
          mvps: number;
          wins: number;
          draws: number;
          losses: number;
          eligible_matches: number;
          attendance_pct: number | null;
        }[];
      };
      player_history: {
        Args: { p_player: string; p_season?: string | null };
        Returns: {
          match_id: string;
          starts_at: string;
          team: Database["public"]["Enums"]["team_side"];
          team_a_name: string;
          team_b_name: string;
          score_a: number;
          score_b: number;
          goals: number;
          assists: number;
          is_mvp: boolean;
        }[];
      };
      group_summary: { Args: { p_season?: string | null }; Returns: Json };
      treasury_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      player_balances: {
        Args: Record<PropertyKey, never>;
        Returns: { player_id: string; charged: number; paid: number; debt: number }[];
      };
      mark_notifications_read: { Args: { p_ids?: string[] | null }; Returns: undefined };
      tick: { Args: Record<PropertyKey, never>; Returns: undefined };
    };
    Enums: {
      player_role: "admin" | "player";
      player_position: "GK" | "DEF" | "MID" | "ATT";
      match_status: "scheduled" | "played" | "cancelled";
      match_kind: "internal" | "external";
      attendance_status: "yes" | "no" | "maybe";
      team_side: "A" | "B";
      mvp_mode: "vote" | "manual" | "none";
      treasury_type: "fine" | "payment" | "contribution" | "expense" | "income";
      invite_kind: "group" | "recovery";
      request_status: "pending" | "approved" | "rejected" | "cancelled";
      notification_type:
        | "new_event"
        | "rsvp_reminder"
        | "match_reminder"
        | "mvp_open"
        | "mvp_result"
        | "fine"
        | "payment"
        | "contribution"
        | "access_request"
        | "system";
    };
    CompositeTypes: Record<never, never>;
  };
};

type Public = Database["public"];
export type Row<T extends keyof Public["Tables"]> = Public["Tables"][T]["Row"];
export type Enum<T extends keyof Public["Enums"]> = Public["Enums"][T];
export type FnReturn<T extends keyof Public["Functions"]> = Public["Functions"][T]["Returns"];

export type Group = Row<"groups">;
export type Player = Row<"players">;
export type Season = Row<"seasons">;
export type Match = Row<"matches">;
export type Attendance = Row<"attendance">;
export type LineupRow = Row<"match_player_stats">;
export type Goal = Row<"match_goals">;
export type TreasuryEntry = Row<"treasury_entries">;
export type Notification = Row<"notifications">;
export type PlayerStats = FnReturn<"player_stats">[number];
export type PlayerHistoryRow = FnReturn<"player_history">[number];
