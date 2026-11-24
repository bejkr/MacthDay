-- MATCHDAY · 1/4 · Schéma
-- Tabuľky, typy, indexy a constraints. RLS a funkcie sú v ďalších migráciách.

create schema if not exists private;

-- ───────────────────────── Typy ─────────────────────────
create type public.player_role       as enum ('admin', 'player');
create type public.player_position   as enum ('GK', 'DEF', 'MID', 'ATT');
create type public.match_status      as enum ('scheduled', 'played', 'cancelled');
create type public.match_kind        as enum ('internal', 'external');
create type public.attendance_status as enum ('yes', 'no', 'maybe');
create type public.team_side         as enum ('A', 'B');
create type public.mvp_mode          as enum ('vote', 'manual', 'none');
create type public.treasury_type     as enum ('fine', 'payment', 'contribution', 'expense', 'income');
create type public.invite_kind       as enum ('group', 'recovery');
create type public.request_status    as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.notification_type as enum (
  'new_event', 'rsvp_reminder', 'match_reminder', 'mvp_open', 'mvp_result',
  'fine', 'payment', 'contribution', 'access_request', 'system'
);

-- ───────────────────────── Konfigurácia inštancie ─────────────────────────
-- Jeden riadok. max_groups obmedzuje, koľko partií môže na tejto inštancii vzniknúť.
create table public.app_config (
  id         boolean primary key default true check (id),
  max_groups integer not null default 1 check (max_groups >= 0)
);
insert into public.app_config (id) values (true);

-- ───────────────────────── Partie ─────────────────────────
create table public.groups (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 2 and 40),
  max_players          integer not null default 30 check (max_players between 2 and 100),
  allow_avatar_edit    boolean not null default true,
  mvp_vote_hours       integer not null default 24 check (mvp_vote_hours between 1 and 168),
  rsvp_reminder_hours  integer not null default 24 check (rsvp_reminder_hours between 1 and 168),
  match_reminder_hours integer not null default 3 check (match_reminder_hours between 1 and 72),
  currency             text not null default 'EUR' check (char_length(currency) = 3),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ───────────────────────── Hráči ─────────────────────────
create table public.players (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  nickname      text not null check (char_length(nickname) between 2 and 24),
  nickname_key  text generated always as (lower(nickname)) stored,
  role          public.player_role not null default 'player',
  jersey_number smallint check (jersey_number between 0 and 99),
  position      public.player_position,
  skill         smallint not null default 3 check (skill between 1 and 5),
  avatar_path   text,
  avatar_color  text not null default '#78C95A' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active     boolean not null default true,
  joined_on     date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (group_id, nickname_key)
);
create index players_group_idx on public.players (group_id);

-- Zariadenie = jedna anonymná Supabase identita. Jedna identita patrí najviac jednému hráčovi.
create table public.player_devices (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  label        text check (char_length(label) <= 80),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index player_devices_player_idx on public.player_devices (player_id);

-- Voliteľný e-mail pre upozornenia. Samostatná tabuľka, aby ho nevideli spoluhráči.
create table public.player_contacts (
  player_id     uuid primary key references public.players (id) on delete cascade,
  email         text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_enabled boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- ───────────────────────── Pozvánky a prístup ─────────────────────────
-- Token sa nikdy neukladá, iba jeho SHA-256 hash.
create table public.invite_links (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  kind       public.invite_kind not null default 'group',
  player_id  uuid references public.players (id) on delete cascade,
  token_hash text not null unique,
  max_uses   integer check (max_uses > 0),
  use_count  integer not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'recovery') = (player_id is not null))
);
create index invite_links_group_idx on public.invite_links (group_id);

create table public.access_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  player_id    uuid not null references public.players (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  nickname     text not null,
  device_label text check (char_length(device_label) <= 80),
  status       public.request_status not null default 'pending',
  decided_by   uuid references public.players (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index access_requests_one_pending on public.access_requests (auth_user_id) where status = 'pending';
create index access_requests_group_idx on public.access_requests (group_id, status);

-- Záznam pokusov o vstup – podklad pre rate limiting.
create table public.join_attempts (
  id             bigint generated always as identity primary key,
  auth_user_id   uuid not null,
  invite_link_id uuid references public.invite_links (id) on delete cascade,
  outcome        text not null,
  created_at     timestamptz not null default now()
);
create index join_attempts_user_idx on public.join_attempts (auth_user_id, created_at);
create index join_attempts_link_idx on public.join_attempts (invite_link_id, created_at);

-- ───────────────────────── Sezóny ─────────────────────────
create table public.seasons (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  starts_on  date not null default current_date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (group_id, name),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index seasons_one_current on public.seasons (group_id) where is_current;

-- ───────────────────────── Zápasy (termín = zápas v stave "scheduled") ─────────────────────────
create table public.matches (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid not null references public.groups (id) on delete cascade,
  season_id            uuid not null references public.seasons (id) on delete restrict,
  status               public.match_status not null default 'scheduled',
  kind                 public.match_kind not null default 'internal',
  starts_at            timestamptz not null,
  location             text check (char_length(location) <= 120),
  note                 text check (char_length(note) <= 500),
  max_players          integer check (max_players between 2 and 60),
  signup_closes_at     timestamptz,
  team_a_name          text not null default 'Tím A' check (char_length(team_a_name) between 1 and 30),
  team_b_name          text not null default 'Tím B' check (char_length(team_b_name) between 1 and 30),
  score_a              smallint check (score_a between 0 and 99),
  score_b              smallint check (score_b between 0 and 99),
  result_note          text check (char_length(result_note) <= 500),
  mvp_mode             public.mvp_mode not null default 'vote',
  mvp_player_id        uuid references public.players (id) on delete set null,
  mvp_voting_closes_at timestamptz,
  mvp_finalized_at     timestamptz,
  created_by           uuid references public.players (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (status <> 'played' or (score_a is not null and score_b is not null)),
  check (signup_closes_at is null or signup_closes_at <= starts_at)
);
create index matches_group_starts_idx on public.matches (group_id, starts_at desc);
create index matches_season_idx on public.matches (season_id);
create index matches_mvp_due_idx on public.matches (mvp_voting_closes_at) where mvp_finalized_at is null and mvp_mode = 'vote';

-- Prihlásenie na termín (prídem / neprídem / možno).
create table public.attendance (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  status     public.attendance_status not null,
  updated_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id)
);
create index attendance_player_idx on public.attendance (player_id);

-- Zostava: kto v zápase nastúpil a za ktorý tím. Pri termíne slúži ako uložené rozdelenie tímov.
create table public.match_player_stats (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  team       public.team_side not null,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);
create index match_player_stats_player_idx on public.match_player_stats (player_id);

-- Jednotlivé góly. Góly a asistencie hráčov sa počítajú výhradne odtiaľto.
create table public.match_goals (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  team        public.team_side not null,
  scorer_id   uuid not null references public.players (id) on delete cascade,
  assist_id   uuid references public.players (id) on delete set null,
  is_own_goal boolean not null default false,
  seq         smallint not null default 0,
  created_at  timestamptz not null default now(),
  check (assist_id is null or assist_id <> scorer_id),
  check (not is_own_goal or assist_id is null)
);
create index match_goals_match_idx on public.match_goals (match_id);
create index match_goals_scorer_idx on public.match_goals (scorer_id);
create index match_goals_assist_idx on public.match_goals (assist_id);

-- MVP hlasy. Jeden hlas na hráča a zápas, nikdy za seba.
create table public.mvp_votes (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches (id) on delete cascade,
  voter_id     uuid not null references public.players (id) on delete cascade,
  candidate_id uuid not null references public.players (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (match_id, voter_id),
  check (voter_id <> candidate_id)
);
create index mvp_votes_candidate_idx on public.mvp_votes (match_id, candidate_id);

-- ───────────────────────── Pokladnica ─────────────────────────
-- fine, contribution  → zvyšujú dlh hráča, hotovosť nemenia
-- payment             → znižuje dlh hráča a zvyšuje hotovosť
-- income / expense    → menia iba hotovosť
create table public.treasury_entries (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  player_id  uuid references public.players (id) on delete restrict,
  type       public.treasury_type not null,
  amount     numeric(10, 2) not null check (amount > 0 and amount <= 100000),
  entry_date date not null default current_date,
  note       text check (char_length(note) <= 300),
  created_by uuid not null references public.players (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (type not in ('fine', 'payment', 'contribution') or player_id is not null),
  check (type <> 'expense' or player_id is null)
);
create index treasury_group_date_idx on public.treasury_entries (group_id, entry_date desc);
create index treasury_player_idx on public.treasury_entries (player_id);

-- ───────────────────────── Upozornenia ─────────────────────────
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null check (char_length(title) <= 120),
  body       text check (char_length(body) <= 400),
  link       text check (link is null or link ~ '^/[A-Za-z0-9/_-]*$'),
  dedupe_key text,
  read_at    timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, dedupe_key)
);
create index notifications_player_idx on public.notifications (player_id, created_at desc);
create index notifications_unread_idx on public.notifications (player_id) where read_at is null;
create index notifications_email_queue_idx on public.notifications (created_at) where emailed_at is null;
