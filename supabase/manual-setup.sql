-- MATCHDAY · kompletné nastavenie databázy pre Supabase SQL Editor
-- Vygenerované zo súborov v supabase/migrations/ – neupravuj ručne, zmeny rob v migráciách.
-- Spusti RAZ na prázdnom projekte: SQL Editor → New query → vlož celý obsah → Run.
-- Beží ako jedna transakcia: ak niečo zlyhá, nič sa neuloží.

begin;

-- ════════════════ 20261117100000_schema.sql ════════════════
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

-- ════════════════ 20261117100100_security.sql ════════════════
-- MATCHDAY · 2/4 · Identita, oprávnenia a RLS
-- Zásady:
--   * klient nikdy neurčuje svoju rolu ani skupinu – všetko sa odvodzuje z auth.uid()
--   * čítanie: člen vidí údaje svojej partie
--   * zápis: buď admin cez RLS politiku, alebo hráč cez úzko vymedzené RPC

-- ───────────────────────── Pomocné funkcie (schéma private nie je vystavená cez API) ─────────────────────────
create or replace function private.my_player_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select d.player_id
  from public.player_devices d
  join public.players p on p.id = d.player_id
  where d.auth_user_id = (select auth.uid()) and p.is_active
$$;

create or replace function private.my_group_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.group_id
  from public.player_devices d
  join public.players p on p.id = d.player_id
  where d.auth_user_id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.player_devices d
    join public.players p on p.id = d.player_id
    where d.auth_user_id = (select auth.uid()) and p.is_active and p.role = 'admin'
  )
$$;

create or replace function private.player_group(p_player uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.players where id = p_player
$$;

create or replace function private.match_group(p_match uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.matches where id = p_match
$$;

create or replace function private.season_group(p_season uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.seasons where id = p_season
$$;

-- Vyhodí chybu, ak volajúci nie je admin. Vracia jeho player_id.
create or replace function private.require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v := private.my_player_id();
  return v;
end $$;

create or replace function private.require_player()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.my_player_id();
begin
  if v is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function private.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

create or replace function private.notify(
  p_group uuid, p_player uuid, p_type public.notification_type,
  p_title text, p_body text, p_link text, p_dedupe text default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (group_id, player_id, type, title, body, link, dedupe_key)
  values (p_group, p_player, p_type, left(p_title, 120), left(p_body, 400), p_link, p_dedupe)
  on conflict (player_id, dedupe_key) do nothing
$$;

-- ───────────────────────── Triggery: integrita ─────────────────────────
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger groups_touch     before update on public.groups     for each row execute function private.touch_updated_at();
create trigger players_touch    before update on public.players    for each row execute function private.touch_updated_at();
create trigger matches_touch    before update on public.matches    for each row execute function private.touch_updated_at();
create trigger attendance_touch before update on public.attendance for each row execute function private.touch_updated_at();

-- Hráča nemožno presunúť do inej partie a partia nesmie zostať bez aktívneho admina.
create or replace function private.guard_players()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.group_id <> old.group_id then
    raise exception 'group_immutable';
  end if;
  new.nickname := btrim(regexp_replace(new.nickname, '\s+', ' ', 'g'));
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    if not exists (
      select 1 from public.players
      where group_id = old.group_id and id <> old.id and role = 'admin' and is_active
    ) then
      raise exception 'last_admin';
    end if;
  end if;
  return new;
end $$;
create trigger players_guard before update on public.players for each row execute function private.guard_players();

-- Zápas a sezóna musia patriť do tej istej partie; partiu zápasu nemožno zmeniť.
create or replace function private.guard_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.group_id <> old.group_id then
    raise exception 'group_immutable';
  end if;
  if private.season_group(new.season_id) is distinct from new.group_id then
    raise exception 'season_mismatch';
  end if;
  return new;
end $$;
create trigger matches_guard before insert or update on public.matches for each row execute function private.guard_matches();

-- ───────────────────────── Triggery: upozornenia ─────────────────────────
create or replace function private.on_match_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'scheduled' and new.starts_at > now() then
    perform private.notify(
      new.group_id, p.id, 'new_event', 'Nový termín',
      to_char(new.starts_at at time zone 'Europe/Bratislava', 'DD.MM.YYYY HH24:MI')
        || coalesce(' · ' || new.location, '') || ' — daj vedieť, či prídeš.',
      '/terminy/' || new.id, 'new_event:' || new.id
    )
    from public.players p
    where p.group_id = new.group_id and p.is_active and p.id is distinct from new.created_by;
  end if;
  return new;
end $$;
create trigger matches_notify after insert on public.matches for each row execute function private.on_match_created();

create or replace function private.on_treasury_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_amount text := trim(to_char(new.amount, 'FM999990.00')) || ' €';
begin
  if new.player_id is null or new.player_id = new.created_by then
    return new;
  end if;
  if new.type = 'fine' then
    perform private.notify(new.group_id, new.player_id, 'fine', 'Nová pokuta ' || v_amount, new.note, '/pokladnica', null);
  elsif new.type = 'payment' then
    perform private.notify(new.group_id, new.player_id, 'payment', 'Evidovaná platba ' || v_amount, new.note, '/pokladnica', null);
  elsif new.type = 'contribution' then
    perform private.notify(new.group_id, new.player_id, 'contribution', 'Nový príspevok ' || v_amount, new.note, '/pokladnica', null);
  end if;
  return new;
end $$;
create trigger treasury_notify after insert on public.treasury_entries for each row execute function private.on_treasury_created();

create or replace function private.on_access_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(
    new.group_id, p.id, 'access_request', 'Žiadosť o prístup',
    'Nové zariadenie žiada o prístup k hráčovi „' || new.nickname || '“.',
    '/nastavenia', 'access_request:' || new.id
  )
  from public.players p
  where p.group_id = new.group_id and p.is_active and p.role = 'admin';
  return new;
end $$;
create trigger access_requests_notify after insert on public.access_requests for each row execute function private.on_access_request();

-- ───────────────────────── RLS ─────────────────────────
alter table public.app_config         enable row level security;
alter table public.groups             enable row level security;
alter table public.players            enable row level security;
alter table public.player_devices     enable row level security;
alter table public.player_contacts    enable row level security;
alter table public.invite_links       enable row level security;
alter table public.access_requests    enable row level security;
alter table public.join_attempts      enable row level security;
alter table public.seasons            enable row level security;
alter table public.matches            enable row level security;
alter table public.attendance         enable row level security;
alter table public.match_player_stats enable row level security;
alter table public.match_goals        enable row level security;
alter table public.mvp_votes          enable row level security;
alter table public.treasury_entries   enable row level security;
alter table public.notifications      enable row level security;

-- app_config, join_attempts: žiadne politiky = žiadny prístup z klienta.

-- groups
create policy groups_select on public.groups for select to authenticated
  using (id = (select private.my_group_id()));
create policy groups_update_admin on public.groups for update to authenticated
  using (id = (select private.my_group_id()) and (select private.is_admin()))
  with check (id = (select private.my_group_id()) and (select private.is_admin()));

-- players
create policy players_select on public.players for select to authenticated
  using (group_id = (select private.my_group_id()));
create policy players_insert_admin on public.players for insert to authenticated
  with check (group_id = (select private.my_group_id()) and (select private.is_admin()));
create policy players_update_admin on public.players for update to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()))
  with check (group_id = (select private.my_group_id()) and (select private.is_admin()));

-- player_devices: vlastné zariadenie, admin všetky v partii
create policy devices_select on public.player_devices for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or ((select private.is_admin()) and private.player_group(player_id) = (select private.my_group_id()))
  );
create policy devices_delete_admin on public.player_devices for delete to authenticated
  using ((select private.is_admin()) and private.player_group(player_id) = (select private.my_group_id()));

-- player_contacts: iba vlastný e-mail
create policy contacts_select_own on public.player_contacts for select to authenticated
  using (player_id = (select private.my_player_id()));
create policy contacts_insert_own on public.player_contacts for insert to authenticated
  with check (player_id = (select private.my_player_id()));
create policy contacts_update_own on public.player_contacts for update to authenticated
  using (player_id = (select private.my_player_id()))
  with check (player_id = (select private.my_player_id()));
create policy contacts_delete_own on public.player_contacts for delete to authenticated
  using (player_id = (select private.my_player_id()));

-- invite_links: číta iba admin, zápis výhradne cez RPC
create policy invites_select_admin on public.invite_links for select to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()));

-- access_requests: žiadateľ vidí svoju, admin všetky v partii; zápis cez RPC
create policy requests_select on public.access_requests for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (group_id = (select private.my_group_id()) and (select private.is_admin()))
  );

-- seasons
create policy seasons_select on public.seasons for select to authenticated
  using (group_id = (select private.my_group_id()));
create policy seasons_update_admin on public.seasons for update to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()))
  with check (group_id = (select private.my_group_id()) and (select private.is_admin()));

-- matches
create policy matches_select on public.matches for select to authenticated
  using (group_id = (select private.my_group_id()));
create policy matches_insert_admin on public.matches for insert to authenticated
  with check (group_id = (select private.my_group_id()) and (select private.is_admin()));
create policy matches_update_admin on public.matches for update to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()))
  with check (group_id = (select private.my_group_id()) and (select private.is_admin()));
create policy matches_delete_admin on public.matches for delete to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()));

-- attendance, zostavy, góly: čítanie pre partiu, zápis cez RPC
create policy attendance_select on public.attendance for select to authenticated
  using (private.match_group(match_id) = (select private.my_group_id()));
create policy lineups_select on public.match_player_stats for select to authenticated
  using (private.match_group(match_id) = (select private.my_group_id()));
create policy goals_select on public.match_goals for select to authenticated
  using (private.match_group(match_id) = (select private.my_group_id()));

-- mvp_votes: tajné hlasovanie – každý vidí iba svoj hlas, výsledok ide cez mvp_status()
create policy votes_select_own on public.mvp_votes for select to authenticated
  using (voter_id = (select private.my_player_id()));

-- treasury_entries: hráč vidí svoje položky a spoločné príjmy/výdavky, admin všetko
create policy treasury_select on public.treasury_entries for select to authenticated
  using (
    group_id = (select private.my_group_id())
    and ((select private.is_admin()) or player_id is null or player_id = (select private.my_player_id()))
  );
create policy treasury_insert_admin on public.treasury_entries for insert to authenticated
  with check (
    group_id = (select private.my_group_id())
    and (select private.is_admin())
    and created_by = (select private.my_player_id())
    and (player_id is null or private.player_group(player_id) = group_id)
  );
create policy treasury_delete_admin on public.treasury_entries for delete to authenticated
  using (group_id = (select private.my_group_id()) and (select private.is_admin()));

-- notifications: iba vlastné; označenie ako prečítané cez RPC
create policy notifications_select_own on public.notifications for select to authenticated
  using (player_id = (select private.my_player_id()));

-- ───────────────────────── Privilégiá ─────────────────────────
-- Neprihlásený (anon) klient nemá k dátam žiadny prístup. Anonymné prihlásenie
-- cez Supabase Auth používa rolu "authenticated".
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on
  public.groups, public.players, public.player_devices, public.player_contacts,
  public.invite_links, public.access_requests, public.seasons, public.matches,
  public.attendance, public.match_player_stats, public.match_goals, public.mvp_votes,
  public.treasury_entries, public.notifications
to authenticated;

-- Stĺpcové oprávnenia: aj admin smie meniť iba to, čo má.
grant update (name, max_players, allow_avatar_edit, mvp_vote_hours, rsvp_reminder_hours, match_reminder_hours)
  on public.groups to authenticated;
grant insert (group_id, nickname, jersey_number, position, skill, avatar_color, joined_on)
  on public.players to authenticated;
grant update (nickname, role, jersey_number, position, skill, avatar_color, is_active, joined_on)
  on public.players to authenticated;
grant delete on public.player_devices to authenticated;
grant insert (player_id, email, email_enabled, updated_at), update (player_id, email, email_enabled, updated_at), delete
  on public.player_contacts to authenticated;
grant update (name, starts_on, ends_on) on public.seasons to authenticated;
grant insert (group_id, season_id, kind, starts_at, location, note, max_players, signup_closes_at, team_a_name, team_b_name, created_by),
      update (season_id, status, kind, starts_at, location, note, max_players, signup_closes_at, team_a_name, team_b_name),
      delete
  on public.matches to authenticated;
grant insert (group_id, player_id, type, amount, entry_date, note, created_by), delete
  on public.treasury_entries to authenticated;

grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.my_player_id(), private.my_group_id(), private.is_admin(),
  private.player_group(uuid), private.match_group(uuid), private.season_group(uuid)
to authenticated;

-- ════════════════ 20261117100200_rpc.sql ════════════════
-- MATCHDAY · 3/4 · RPC funkcie
-- Všetky privilegované zápisy idú cez tieto funkcie. Každá si sama overí,
-- kto ju volá (auth.uid() → zariadenie → hráč → rola). Chyby vracajú krátky
-- kód v message, ktorý aplikácia preloží na zrozumiteľnú hlášku.

-- ═════════════════════════ IDENTITA ═════════════════════════

-- Stav aktuálneho zariadenia: member / pending / rejected / blocked / guest / anonymous
create or replace function public.whoami()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_player public.players;
  v_req    public.access_requests;
begin
  if v_uid is null then
    return jsonb_build_object('state', 'anonymous');
  end if;

  select p.* into v_player
  from public.player_devices d join public.players p on p.id = d.player_id
  where d.auth_user_id = v_uid;

  if found then
    if not v_player.is_active then
      return jsonb_build_object('state', 'blocked');
    end if;
    update public.player_devices set last_seen_at = now()
    where auth_user_id = v_uid and last_seen_at < now() - interval '1 hour';
    return jsonb_build_object(
      'state', 'member',
      'player', to_jsonb(v_player),
      'group', (select to_jsonb(g) from public.groups g where g.id = v_player.group_id),
      'season', (select to_jsonb(s) from public.seasons s where s.group_id = v_player.group_id and s.is_current),
      'unread', (select count(*) from public.notifications n where n.player_id = v_player.id and n.read_at is null)
    );
  end if;

  select * into v_req from public.access_requests
  where auth_user_id = v_uid order by created_at desc limit 1;
  if found and v_req.status in ('pending', 'rejected') then
    return jsonb_build_object(
      'state', v_req.status::text,
      'nickname', v_req.nickname,
      'group_name', (select name from public.groups where id = v_req.group_id)
    );
  end if;

  return jsonb_build_object('state', 'guest');
end $$;

-- Dá sa ešte založiť partia? (počet partií < app_config.max_groups)
create or replace function public.setup_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.groups) < (select max_groups from public.app_config)
$$;

-- Založenie partie. Volajúci sa stane prvým adminom.
create or replace function public.create_group(p_name text, p_nickname text, p_season text, p_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_max    integer;
  v_group  uuid;
  v_player uuid;
  v_nick   text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  v_name   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null then raise exception 'no_session'; end if;
  if exists (select 1 from public.player_devices where auth_user_id = v_uid) then
    raise exception 'already_member';
  end if;

  select max_groups into v_max from public.app_config for update;
  if (select count(*) from public.groups) >= v_max then
    raise exception 'setup_closed';
  end if;

  insert into public.groups (name) values (v_name) returning id into v_group;
  insert into public.seasons (group_id, name, is_current)
    values (v_group, coalesce(nullif(btrim(p_season), ''), to_char(current_date, 'YYYY')), true);
  insert into public.players (group_id, nickname, role) values (v_group, v_nick, 'admin') returning id into v_player;
  insert into public.player_devices (player_id, auth_user_id, label) values (v_player, v_uid, left(p_label, 80));
  return v_group;
end $$;

-- Náhľad pozvánky pred zadaním prezývky. Nič neprezradí bez platného tokenu.
create or replace function public.peek_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_link public.invite_links;
begin
  select * into v_link from public.invite_links where token_hash = private.hash_token(coalesce(p_token, ''));
  if not found
     or v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now())
     or (v_link.max_uses is not null and v_link.use_count >= v_link.max_uses) then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object(
    'valid', true,
    'kind', v_link.kind::text,
    'group_name', (select name from public.groups where id = v_link.group_id),
    'nickname', (select nickname from public.players where id = v_link.player_id)
  );
end $$;

-- Vstup cez pozývací link.
--   nová prezývka            → vznikne hráč a zariadenie sa s ním prepojí
--   existujúca prezývka      → vznikne ČAKAJÚCA žiadosť, o ktorej rozhodne admin
--   osobný link na obnovu    → zariadenie sa prepojí s konkrétnym hráčom
-- Vracia {status: joined | pending | error, code?}. Chyby sa nevyhadzujú výnimkou,
-- aby sa zachoval záznam pokusu pre rate limiting.
create or replace function public.join_group(p_token text, p_nickname text, p_label text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_link     public.invite_links;
  v_group    public.groups;
  v_existing public.players;
  v_player   uuid;
  v_nick     text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  v_label    text := left(p_label, 80);
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'code', 'no_session');
  end if;
  if exists (select 1 from public.player_devices where auth_user_id = v_uid) then
    return jsonb_build_object('status', 'joined');
  end if;

  -- Rate limit na zariadenie: najviac 8 pokusov za hodinu.
  if (select count(*) from public.join_attempts
      where auth_user_id = v_uid and created_at > now() - interval '1 hour') >= 8 then
    return jsonb_build_object('status', 'error', 'code', 'rate_limited');
  end if;

  select * into v_link from public.invite_links
  where token_hash = private.hash_token(coalesce(p_token, '')) for update;

  if not found
     or v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now())
     or (v_link.max_uses is not null and v_link.use_count >= v_link.max_uses) then
    insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, null, 'invalid_link');
    return jsonb_build_object('status', 'error', 'code', 'invalid_link');
  end if;

  -- Rate limit na link: najviac 30 pokusov za hodinu zo všetkých zariadení spolu.
  if (select count(*) from public.join_attempts
      where invite_link_id = v_link.id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('status', 'error', 'code', 'rate_limited');
  end if;

  select * into v_group from public.groups where id = v_link.group_id;

  -- Osobný link na obnovu prístupu
  if v_link.kind = 'recovery' then
    insert into public.player_devices (player_id, auth_user_id, label) values (v_link.player_id, v_uid, v_label);
    update public.invite_links set use_count = use_count + 1 where id = v_link.id;
    update public.access_requests set status = 'cancelled', decided_at = now()
      where auth_user_id = v_uid and status = 'pending';
    insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, v_link.id, 'recovered');
    perform private.notify(v_group.id, v_link.player_id, 'system', 'Pridané nové zariadenie',
      'K tvojmu hráčovi sa pripojilo nové zariadenie cez link na obnovu.', '/nastavenia', null);
    return jsonb_build_object('status', 'joined');
  end if;

  if char_length(v_nick) < 2 or char_length(v_nick) > 24 then
    insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, v_link.id, 'invalid_nickname');
    return jsonb_build_object('status', 'error', 'code', 'invalid_nickname');
  end if;

  select * into v_existing from public.players
  where group_id = v_group.id and nickname_key = lower(v_nick);

  -- Prezývka už existuje: NIKDY nedať prístup automaticky, iba žiadosť na schválenie.
  if found then
    update public.access_requests set status = 'cancelled', decided_at = now()
      where auth_user_id = v_uid and status = 'pending';
    insert into public.access_requests (group_id, player_id, auth_user_id, nickname, device_label)
      values (v_group.id, v_existing.id, v_uid, v_existing.nickname, v_label);
    insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, v_link.id, 'requested');
    return jsonb_build_object('status', 'pending');
  end if;

  if (select count(*) from public.players where group_id = v_group.id and is_active) >= v_group.max_players then
    insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, v_link.id, 'group_full');
    return jsonb_build_object('status', 'error', 'code', 'group_full');
  end if;

  insert into public.players (group_id, nickname) values (v_group.id, v_nick) returning id into v_player;
  insert into public.player_devices (player_id, auth_user_id, label) values (v_player, v_uid, v_label);
  update public.invite_links set use_count = use_count + 1 where id = v_link.id;
  update public.access_requests set status = 'cancelled', decided_at = now()
    where auth_user_id = v_uid and status = 'pending';
  insert into public.join_attempts (auth_user_id, invite_link_id, outcome) values (v_uid, v_link.id, 'joined');
  return jsonb_build_object('status', 'joined');
end $$;

create or replace function public.cancel_my_request()
returns void language sql security definer set search_path = '' as $$
  update public.access_requests set status = 'cancelled', decided_at = now()
  where auth_user_id = auth.uid() and status in ('pending', 'rejected')
$$;

-- Admin: schválenie / zamietnutie žiadosti o prístup k existujúcemu hráčovi.
create or replace function public.decide_access_request(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := private.require_admin();
  v_req public.access_requests;
begin
  select * into v_req from public.access_requests
  where id = p_request and group_id = private.my_group_id() and status = 'pending' for update;
  if not found then raise exception 'not_found'; end if;

  if p_approve then
    if exists (select 1 from public.player_devices where auth_user_id = v_req.auth_user_id) then
      raise exception 'device_already_linked';
    end if;
    insert into public.player_devices (player_id, auth_user_id, label)
      values (v_req.player_id, v_req.auth_user_id, v_req.device_label);
    perform private.notify(v_req.group_id, v_req.player_id, 'system', 'Pridané nové zariadenie',
      'Admin schválil prístup nového zariadenia k tvojmu hráčovi.', '/nastavenia', null);
  end if;

  update public.access_requests
  set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
      decided_by = v_me, decided_at = now()
  where id = v_req.id;
end $$;

-- Admin: nový pozývací link. Pri type "group" sa všetky doterajšie skupinové linky
-- zneplatnia (rotácia). Token sa vráti iba raz – v databáze ostáva len hash.
create or replace function public.create_invite_link(
  p_kind text default 'group', p_player uuid default null,
  p_max_uses integer default 30, p_expires_hours integer default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_admin();
  v_group uuid := private.my_group_id();
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if p_kind = 'recovery' then
    if p_player is null or private.player_group(p_player) is distinct from v_group then
      raise exception 'not_found';
    end if;
    update public.invite_links set revoked_at = now()
      where group_id = v_group and kind = 'recovery' and player_id = p_player and revoked_at is null;
    insert into public.invite_links (group_id, kind, player_id, token_hash, max_uses, expires_at, created_by)
      values (v_group, 'recovery', p_player, private.hash_token(v_token), 1,
              now() + make_interval(hours => least(greatest(coalesce(p_expires_hours, 24), 1), 168)), v_me);
  elsif p_kind = 'group' then
    update public.invite_links set revoked_at = now()
      where group_id = v_group and kind = 'group' and revoked_at is null;
    insert into public.invite_links (group_id, kind, token_hash, max_uses, expires_at, created_by)
      values (v_group, 'group', private.hash_token(v_token),
              least(greatest(coalesce(p_max_uses, 30), 1), 200),
              case when p_expires_hours is null then null
                   else now() + make_interval(hours => least(greatest(p_expires_hours, 1), 24 * 90)) end,
              v_me);
  else
    raise exception 'invalid_kind';
  end if;
  return v_token;
end $$;

create or replace function public.revoke_invite_link(p_link uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.invite_links set revoked_at = now()
  where id = p_link and group_id = private.my_group_id() and revoked_at is null;
end $$;

-- Avatar: hráč iba sebe (ak to partia povoľuje), admin komukoľvek v partii.
create or replace function public.set_avatar(p_player uuid, p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_player();
  v_group uuid := private.my_group_id();
  v_old   text;
begin
  if private.player_group(p_player) is distinct from v_group then raise exception 'not_found'; end if;
  if not private.is_admin() then
    if p_player <> v_me then raise exception 'forbidden' using errcode = '42501'; end if;
    if not (select allow_avatar_edit from public.groups where id = v_group) then
      raise exception 'avatar_edit_disabled';
    end if;
  end if;
  if p_path is not null and p_path !~ ('^' || v_group::text || '/' || p_player::text || '-[a-z0-9]{8,40}\.jpg$') then
    raise exception 'invalid_path';
  end if;
  select avatar_path into v_old from public.players where id = p_player;
  update public.players set avatar_path = p_path where id = p_player;
  return v_old;
end $$;

-- ═════════════════════════ SEZÓNY ═════════════════════════
create or replace function public.start_new_season(p_name text, p_starts_on date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
  v_id    uuid;
begin
  perform private.require_admin();
  v_group := private.my_group_id();
  update public.seasons
    set is_current = false, ends_on = coalesce(ends_on, greatest(starts_on, p_starts_on - 1))
    where group_id = v_group and is_current;
  insert into public.seasons (group_id, name, starts_on, is_current)
    values (v_group, btrim(p_name), p_starts_on, true) returning id into v_id;
  return v_id;
end $$;

-- ═════════════════════════ DOCHÁDZKA ═════════════════════════
create or replace function public.set_attendance(p_match uuid, p_status public.attendance_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.require_player();
  v_m  public.matches;
begin
  select * into v_m from public.matches
  where id = p_match and group_id = private.my_group_id() for update;
  if not found then raise exception 'not_found'; end if;
  if v_m.status <> 'scheduled' then raise exception 'signup_closed'; end if;
  if now() >= coalesce(v_m.signup_closes_at, v_m.starts_at) then raise exception 'signup_closed'; end if;

  if p_status = 'yes' and v_m.max_players is not null and (
    select count(*) from public.attendance
    where match_id = p_match and status = 'yes' and player_id <> v_me
  ) >= v_m.max_players then
    raise exception 'match_full';
  end if;

  insert into public.attendance (match_id, player_id, status, updated_by)
  values (p_match, v_me, p_status, v_me)
  on conflict (match_id, player_id) do update set status = excluded.status, updated_by = excluded.updated_by;
end $$;

-- Admin môže dochádzku opraviť kedykoľvek, aj spätne. p_status = null záznam zmaže.
create or replace function public.admin_set_attendance(p_match uuid, p_player uuid, p_status public.attendance_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_admin();
  v_group uuid := private.my_group_id();
begin
  if private.match_group(p_match) is distinct from v_group
     or private.player_group(p_player) is distinct from v_group then
    raise exception 'not_found';
  end if;
  if p_status is null then
    delete from public.attendance where match_id = p_match and player_id = p_player;
  else
    insert into public.attendance (match_id, player_id, status, updated_by)
    values (p_match, p_player, p_status, v_me)
    on conflict (match_id, player_id) do update set status = excluded.status, updated_by = excluded.updated_by;
  end if;
end $$;

-- ═════════════════════════ ZOSTAVY A VÝSLEDKY ═════════════════════════
-- Uloženie rozdelenia tímov k termínu.
create or replace function public.save_lineup(p_match uuid, p_team_a uuid[], p_team_b uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
  v_all   uuid[] := coalesce(p_team_a, '{}') || coalesce(p_team_b, '{}');
begin
  perform private.require_admin();
  v_group := private.my_group_id();
  if not exists (select 1 from public.matches where id = p_match and group_id = v_group and status = 'scheduled') then
    raise exception 'not_found';
  end if;
  if (select count(*) from unnest(v_all) x) <> (select count(distinct x) from unnest(v_all) x)
     or exists (select 1 from unnest(v_all) x left join public.players p on p.id = x and p.group_id = v_group where p.id is null) then
    raise exception 'invalid_lineup';
  end if;
  delete from public.match_player_stats where match_id = p_match;
  insert into public.match_player_stats (match_id, player_id, team)
    select p_match, x, 'A'::public.team_side from unnest(coalesce(p_team_a, '{}')) x
    union all
    select p_match, x, 'B'::public.team_side from unnest(coalesce(p_team_b, '{}')) x;
end $$;

-- Zápis (alebo oprava) výsledku zápasu v jednej transakcii.
-- p_match = null → vytvorí sa nový odohraný zápas (spätné doplnenie histórie).
-- p = { starts_at?, season_id?, location?, kind, team_a_name, team_b_name, score_a, score_b,
--       result_note?, mvp_mode: vote|manual|none, mvp_player_id?,
--       lineup: [{player_id, team}], goals: [{team, scorer_id, assist_id?, is_own_goal?}] }
create or replace function public.save_match_result(p_match uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := private.require_admin();
  v_group   uuid := private.my_group_id();
  v_m       public.matches;
  v_score_a integer := (p ->> 'score_a')::integer;
  v_score_b integer := (p ->> 'score_b')::integer;
  v_mode    public.mvp_mode := coalesce(p ->> 'mvp_mode', 'vote')::public.mvp_mode;
  v_mvp     uuid := nullif(p ->> 'mvp_player_id', '')::uuid;
  v_lineup  jsonb := coalesce(p -> 'lineup', '[]'::jsonb);
  v_goals   jsonb := coalesce(p -> 'goals', '[]'::jsonb);
  v_hours   integer;
begin
  if v_score_a is null or v_score_b is null then raise exception 'invalid_score'; end if;

  if p_match is null then
    insert into public.matches (group_id, season_id, starts_at, location, created_by)
    values (
      v_group,
      coalesce(nullif(p ->> 'season_id', '')::uuid,
               (select id from public.seasons where group_id = v_group and is_current)),
      (p ->> 'starts_at')::timestamptz,
      nullif(p ->> 'location', ''),
      v_me
    ) returning * into v_m;
  else
    select * into v_m from public.matches where id = p_match and group_id = v_group for update;
    if not found then raise exception 'not_found'; end if;
  end if;
  if v_m.status = 'cancelled' then raise exception 'match_cancelled'; end if;

  -- Zostava
  if jsonb_array_length(v_lineup) = 0 then raise exception 'empty_lineup'; end if;
  if (select count(*) <> count(distinct l.player_id)
      from jsonb_to_recordset(v_lineup) as l(player_id uuid, team public.team_side))
     or exists (
       select 1 from jsonb_to_recordset(v_lineup) as l(player_id uuid, team public.team_side)
       left join public.players pl on pl.id = l.player_id and pl.group_id = v_group
       where pl.id is null or l.team is null
     ) then
    raise exception 'invalid_lineup';
  end if;

  delete from public.match_player_stats where match_id = v_m.id;
  insert into public.match_player_stats (match_id, player_id, team)
    select v_m.id, l.player_id, l.team
    from jsonb_to_recordset(v_lineup) as l(player_id uuid, team public.team_side);

  -- Góly
  delete from public.match_goals where match_id = v_m.id;
  insert into public.match_goals (match_id, team, scorer_id, assist_id, is_own_goal, seq)
    select v_m.id,
           (t.g ->> 'team')::public.team_side,
           (t.g ->> 'scorer_id')::uuid,
           nullif(t.g ->> 'assist_id', '')::uuid,
           coalesce((t.g ->> 'is_own_goal')::boolean, false),
           t.ord
    from jsonb_array_elements(v_goals) with ordinality as t(g, ord);

  if exists (
    select 1 from public.match_goals g
    left join public.match_player_stats s on s.match_id = g.match_id and s.player_id = g.scorer_id
    where g.match_id = v_m.id
      and (s.id is null
           or (not g.is_own_goal and s.team <> g.team)
           or (g.is_own_goal and s.team = g.team))
  ) then
    raise exception 'scorer_not_in_team';
  end if;
  if exists (
    select 1 from public.match_goals g
    left join public.match_player_stats s on s.match_id = g.match_id and s.player_id = g.assist_id
    where g.match_id = v_m.id and g.assist_id is not null and (s.id is null or s.team <> g.team)
  ) then
    raise exception 'assist_not_in_team';
  end if;
  if (select count(*) from public.match_goals where match_id = v_m.id and team = 'A') > v_score_a
     or (select count(*) from public.match_goals where match_id = v_m.id and team = 'B') > v_score_b then
    raise exception 'goals_exceed_score';
  end if;

  update public.matches set
    status      = 'played',
    kind        = coalesce(nullif(p ->> 'kind', '')::public.match_kind, kind),
    starts_at   = coalesce((p ->> 'starts_at')::timestamptz, starts_at),
    season_id   = coalesce(nullif(p ->> 'season_id', '')::uuid, season_id),
    location    = case when p ? 'location' then nullif(p ->> 'location', '') else location end,
    team_a_name = coalesce(nullif(btrim(p ->> 'team_a_name'), ''), team_a_name),
    team_b_name = coalesce(nullif(btrim(p ->> 'team_b_name'), ''), team_b_name),
    score_a     = v_score_a,
    score_b     = v_score_b,
    result_note = nullif(p ->> 'result_note', ''),
    signup_closes_at = least(signup_closes_at, coalesce((p ->> 'starts_at')::timestamptz, starts_at))
  where id = v_m.id;

  -- MVP
  if v_mode = 'manual' then
    if v_mvp is null or not exists (
      select 1 from public.match_player_stats where match_id = v_m.id and player_id = v_mvp
    ) then
      raise exception 'mvp_not_in_lineup';
    end if;
    delete from public.mvp_votes where match_id = v_m.id;
    update public.matches set mvp_mode = 'manual', mvp_player_id = v_mvp,
      mvp_voting_closes_at = null, mvp_finalized_at = now() where id = v_m.id;
  elsif v_mode = 'none' then
    delete from public.mvp_votes where match_id = v_m.id;
    update public.matches set mvp_mode = 'none', mvp_player_id = null,
      mvp_voting_closes_at = null, mvp_finalized_at = null where id = v_m.id;
  else
    if v_m.mvp_mode <> 'vote' or v_m.mvp_voting_closes_at is null then
      -- Hlasovanie sa otvára prvýkrát
      select mvp_vote_hours into v_hours from public.groups where id = v_group;
      update public.matches set mvp_mode = 'vote', mvp_player_id = null,
        mvp_voting_closes_at = now() + make_interval(hours => v_hours), mvp_finalized_at = null
      where id = v_m.id;
      perform private.notify(v_group, s.player_id, 'mvp_open', 'Hlasuj za MVP zápasu',
        'Hlasovanie je otvorené ' || v_hours || ' h. Vyber najlepšieho hráča zápasu.',
        '/zapasy/' || v_m.id, 'mvp_open:' || v_m.id)
      from public.match_player_stats s where s.match_id = v_m.id;
    else
      -- Oprava zápasu počas/po hlasovaní: zahodiť hlasy hráčov, ktorí už nie sú v zostave
      delete from public.mvp_votes v
      where v.match_id = v_m.id and (
        not exists (select 1 from public.match_player_stats s where s.match_id = v_m.id and s.player_id = v.voter_id)
        or not exists (select 1 from public.match_player_stats s where s.match_id = v_m.id and s.player_id = v.candidate_id)
      );
    end if;
  end if;

  return v_m.id;
end $$;

-- ═════════════════════════ MVP HLASOVANIE ═════════════════════════
create or replace function public.cast_mvp_vote(p_match uuid, p_candidate uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.require_player();
  v_m  public.matches;
begin
  select * into v_m from public.matches where id = p_match and group_id = private.my_group_id();
  if not found then raise exception 'not_found'; end if;
  if v_m.status <> 'played' or v_m.mvp_mode <> 'vote' or v_m.mvp_finalized_at is not null
     or v_m.mvp_voting_closes_at is null or now() >= v_m.mvp_voting_closes_at then
    raise exception 'voting_closed';
  end if;
  if p_candidate = v_me then raise exception 'self_vote'; end if;
  if not exists (select 1 from public.match_player_stats where match_id = p_match and player_id = v_me) then
    raise exception 'not_eligible';
  end if;
  if not exists (select 1 from public.match_player_stats where match_id = p_match and player_id = p_candidate) then
    raise exception 'invalid_candidate';
  end if;
  begin
    insert into public.mvp_votes (match_id, voter_id, candidate_id) values (p_match, v_me, p_candidate);
  exception when unique_violation then
    raise exception 'already_voted';
  end;
end $$;

-- Stav hlasovania pre aktuálneho hráča. Počty hlasov sa zverejnia až po uzavretí.
create or replace function public.mvp_status(p_match uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me     uuid := private.require_player();
  v_m      public.matches;
  v_closed boolean;
begin
  select * into v_m from public.matches where id = p_match and group_id = private.my_group_id();
  if not found then raise exception 'not_found'; end if;
  v_closed := v_m.mvp_mode <> 'vote' or v_m.mvp_finalized_at is not null
              or v_m.mvp_voting_closes_at is null or now() >= v_m.mvp_voting_closes_at;
  return jsonb_build_object(
    'mode', v_m.mvp_mode::text,
    'closed', v_closed,
    'closes_at', v_m.mvp_voting_closes_at,
    'eligible', exists (select 1 from public.match_player_stats where match_id = p_match and player_id = v_me),
    'my_vote', (select candidate_id from public.mvp_votes where match_id = p_match and voter_id = v_me),
    'votes_cast', (select count(*) from public.mvp_votes where match_id = p_match),
    'voters', (select count(*) from public.match_player_stats where match_id = p_match),
    'tally', case when v_closed and v_m.mvp_mode = 'vote' then coalesce((
      select jsonb_agg(jsonb_build_object('player_id', t.candidate_id, 'votes', t.votes) order by t.votes desc)
      from (select candidate_id, count(*) as votes from public.mvp_votes where match_id = p_match group by candidate_id) t
    ), '[]'::jsonb) end
  );
end $$;

-- ═════════════════════════ ŠTATISTIKY (počítané z histórie, žiadne uložené súčty) ═════════════════════════
create or replace function public.player_stats(p_season uuid default null)
returns table (
  player_id uuid, matches_played integer, goals integer, assists integer, mvps integer,
  wins integer, draws integer, losses integer, eligible_matches integer, attendance_pct integer
) language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, starts_at, score_a, score_b, mvp_player_id
    from public.matches
    where status = 'played'
      and group_id = (select private.my_group_id())
      and (p_season is null or season_id = p_season)
  ),
  pl as (
    select s.player_id,
      count(*)::integer as matches_played,
      count(*) filter (where (s.team = 'A' and m.score_a > m.score_b) or (s.team = 'B' and m.score_b > m.score_a))::integer as wins,
      count(*) filter (where m.score_a = m.score_b)::integer as draws,
      count(*) filter (where (s.team = 'A' and m.score_a < m.score_b) or (s.team = 'B' and m.score_b < m.score_a))::integer as losses
    from public.match_player_stats s join m on m.id = s.match_id
    group by s.player_id
  ),
  g as (
    select mg.scorer_id as pid, count(*)::integer as n
    from public.match_goals mg join m on m.id = mg.match_id
    where not mg.is_own_goal group by mg.scorer_id
  ),
  a as (
    select mg.assist_id as pid, count(*)::integer as n
    from public.match_goals mg join m on m.id = mg.match_id
    where mg.assist_id is not null group by mg.assist_id
  ),
  v as (
    select mvp_player_id as pid, count(*)::integer as n
    from m where mvp_player_id is not null group by mvp_player_id
  ),
  e as (
    -- zápasy odohrané odvtedy, čo je hráč v partii, a v koľkých z nich nastúpil
    select p.id as pid, count(m.id)::integer as eligible, count(s.id)::integer as attended
    from public.players p
    left join m on (m.starts_at at time zone 'Europe/Bratislava')::date >= p.joined_on
    left join public.match_player_stats s on s.match_id = m.id and s.player_id = p.id
    where p.group_id = (select private.my_group_id())
    group by p.id
  )
  select p.id,
    coalesce(pl.matches_played, 0), coalesce(g.n, 0), coalesce(a.n, 0), coalesce(v.n, 0),
    coalesce(pl.wins, 0), coalesce(pl.draws, 0), coalesce(pl.losses, 0),
    e.eligible,
    case when e.eligible > 0 then round(100.0 * e.attended / e.eligible)::integer end
  from public.players p
  join e on e.pid = p.id
  left join pl on pl.player_id = p.id
  left join g on g.pid = p.id
  left join a on a.pid = p.id
  left join v on v.pid = p.id
  where p.group_id = (select private.my_group_id())
$$;

-- História výkonov jedného hráča (zápas po zápase).
create or replace function public.player_history(p_player uuid, p_season uuid default null)
returns table (
  match_id uuid, starts_at timestamptz, team public.team_side, team_a_name text, team_b_name text,
  score_a smallint, score_b smallint, goals integer, assists integer, is_mvp boolean
) language sql stable security invoker set search_path = '' as $$
  select m.id, m.starts_at, s.team, m.team_a_name, m.team_b_name, m.score_a, m.score_b,
    (select count(*)::integer from public.match_goals g where g.match_id = m.id and g.scorer_id = p_player and not g.is_own_goal),
    (select count(*)::integer from public.match_goals g where g.match_id = m.id and g.assist_id = p_player),
    coalesce(m.mvp_player_id = p_player, false)
  from public.match_player_stats s
  join public.matches m on m.id = s.match_id
  where s.player_id = p_player and m.status = 'played'
    and m.group_id = (select private.my_group_id())
    and (p_season is null or m.season_id = p_season)
  order by m.starts_at
$$;

-- Súhrn partie pre dashboard.
create or replace function public.group_summary(p_season uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, kind, score_a, score_b from public.matches
    where status = 'played' and group_id = (select private.my_group_id())
      and (p_season is null or season_id = p_season)
  ),
  sizes as (
    select m.id, count(s.id) as n from m left join public.match_player_stats s on s.match_id = m.id group by m.id
  )
  select jsonb_build_object(
    'matches_played', (select count(*) from m),
    'total_goals', (select coalesce(sum(score_a + case when kind = 'internal' then score_b else 0 end), 0) from m),
    'avg_players', (select round(avg(n), 1) from sizes),
    'avg_attendance_pct', (
      select round(avg(attendance_pct)) from public.player_stats(p_season) ps
      join public.players p on p.id = ps.player_id
      where p.is_active and ps.attendance_pct is not null
    )
  )
$$;

-- ═════════════════════════ POKLADNICA ═════════════════════════
-- Hotovosť = platby + iné príjmy − výdavky. Dlh hráča = pokuty + príspevky − platby.
create or replace function public.treasury_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_player();
  v_group uuid := private.my_group_id();
begin
  return (
    with b as (
      select player_id,
        sum(case when type in ('fine', 'contribution') then amount when type = 'payment' then -amount else 0 end) as debt
      from public.treasury_entries
      where group_id = v_group and player_id is not null
      group by player_id
    )
    select jsonb_build_object(
      'cash', (
        select coalesce(sum(case when type in ('payment', 'income') then amount when type = 'expense' then -amount else 0 end), 0)
        from public.treasury_entries where group_id = v_group
      ),
      'outstanding', (select coalesce(sum(debt) filter (where debt > 0), 0) from b),
      'my_debt', coalesce((select debt from b where player_id = v_me), 0)
    )
  );
end $$;

-- Zostatky hráčov: admin vidí všetkých, hráč iba seba.
create or replace function public.player_balances()
returns table (player_id uuid, charged numeric, paid numeric, debt numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_player();
  v_group uuid := private.my_group_id();
  v_admin boolean := private.is_admin();
begin
  return query
    select p.id,
      coalesce(sum(t.amount) filter (where t.type in ('fine', 'contribution')), 0),
      coalesce(sum(t.amount) filter (where t.type = 'payment'), 0),
      coalesce(sum(case when t.type in ('fine', 'contribution') then t.amount when t.type = 'payment' then -t.amount else 0 end), 0)
    from public.players p
    left join public.treasury_entries t on t.player_id = p.id
    where p.group_id = v_group and (v_admin or p.id = v_me)
    group by p.id;
end $$;

-- ═════════════════════════ UPOZORNENIA ═════════════════════════
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where player_id = private.my_player_id() and read_at is null
    and (p_ids is null or id = any (p_ids))
$$;

-- Časovo závislá práca: uzavretie MVP hlasovaní a pripomienky. Idempotentné –
-- spúšťa ho pg_cron (viď ďalšia migrácia) a poistne aj aplikácia cez tick().
create or replace function private.process_due()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r        record;
  v_winner uuid;
  v_nick   text;
begin
  -- 1) Uzavretie MVP hlasovaní
  for r in
    select id, group_id from public.matches
    where mvp_mode = 'vote' and status = 'played' and mvp_finalized_at is null
      and mvp_voting_closes_at <= now()
    for update skip locked
  loop
    select t.candidate_id into v_winner from (
      select v.candidate_id, count(*) as votes,
        (select count(*) from public.match_goals g where g.match_id = r.id and g.scorer_id = v.candidate_id and not g.is_own_goal) as goals,
        (select count(*) from public.match_goals g where g.match_id = r.id and g.assist_id = v.candidate_id) as assists
      from public.mvp_votes v where v.match_id = r.id group by v.candidate_id
    ) t order by t.votes desc, t.goals desc, t.assists desc, t.candidate_id limit 1;

    update public.matches set mvp_player_id = v_winner, mvp_finalized_at = now() where id = r.id;
    select nickname into v_nick from public.players where id = v_winner;

    perform private.notify(r.group_id, s.player_id, 'mvp_result',
      case when v_winner is null then 'Hlasovanie o MVP sa skončilo' else 'MVP zápasu: ' || v_nick end,
      case when v_winner is null then 'Nikto nehlasoval, MVP nebol udelený.' else 'Pozri si výsledky hlasovania.' end,
      '/zapasy/' || r.id, 'mvp_result:' || r.id)
    from public.match_player_stats s where s.match_id = r.id;
    v_winner := null;
  end loop;

  -- 2) Pripomienka nepotvrdenej dochádzky
  perform private.notify(m.group_id, p.id, 'rsvp_reminder', 'Potvrď účasť',
    'Termín ' || to_char(m.starts_at at time zone 'Europe/Bratislava', 'DD.MM. HH24:MI')
      || ' — stále nevieme, či prídeš.',
    '/terminy/' || m.id, 'rsvp_reminder:' || m.id)
  from public.matches m
  join public.groups g on g.id = m.group_id
  join public.players p on p.group_id = m.group_id and p.is_active
  left join public.attendance a on a.match_id = m.id and a.player_id = p.id
  where m.status = 'scheduled'
    and now() < coalesce(m.signup_closes_at, m.starts_at)
    and now() >= coalesce(m.signup_closes_at, m.starts_at) - make_interval(hours => g.rsvp_reminder_hours)
    and (a.id is null or a.status = 'maybe');

  -- 3) Pripomienka pred zápasom pre prihlásených
  perform private.notify(m.group_id, a.player_id, 'match_reminder', 'Dnes sa hrá',
    to_char(m.starts_at at time zone 'Europe/Bratislava', 'HH24:MI') || coalesce(' · ' || m.location, ''),
    '/terminy/' || m.id, 'match_reminder:' || m.id)
  from public.matches m
  join public.groups g on g.id = m.group_id
  join public.attendance a on a.match_id = m.id and a.status = 'yes'
  where m.status = 'scheduled'
    and now() < m.starts_at
    and now() >= m.starts_at - make_interval(hours => g.match_reminder_hours);
end $$;

create or replace function public.tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_player();
  perform private.process_due();
end $$;

-- ═════════════════════════ Privilégiá na funkcie ═════════════════════════
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
-- Tieto dve musia fungovať ešte pred vznikom session (úvodná obrazovka).
grant execute on function public.setup_open(), public.peek_invite(text) to anon;
grant execute on function
  private.my_player_id(), private.my_group_id(), private.is_admin(),
  private.player_group(uuid), private.match_group(uuid), private.season_group(uuid)
to authenticated;

-- ════════════════ 20261117100300_storage_cron.sql ════════════════
-- MATCHDAY · 4/4 · Úložisko avatarov a plánovač

-- ───────────────────────── Avatary ─────────────────────────
-- Verejný bucket (obrázky sa načítavajú priamo cez <img>), ale názov súboru obsahuje
-- náhodnú časť, takže URL sa nedá uhádnuť. Nahrávať smie hráč iba svoj avatar
-- (ak to partia povoľuje) a admin komukoľvek. Cesta: <group_id>/<player_id>-<random>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 262144, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_write_avatar(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    split_part(p_name, '/', 1) = private.my_group_id()::text
    and (
      private.is_admin()
      or (
        split_part(p_name, '/', 2) like private.my_player_id()::text || '-%'
        and coalesce((select allow_avatar_edit from public.groups where id = private.my_group_id()), false)
      )
    )
$$;
revoke execute on function private.can_write_avatar(text) from public, anon;
grant execute on function private.can_write_avatar(text) to authenticated;

create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select private.my_group_id())::text);
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.can_write_avatar(name));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.can_write_avatar(name));

-- ───────────────────────── Plánovač ─────────────────────────
-- Každých 10 minút: uzavretie MVP hlasovaní a pripomienky. Ak pg_cron nie je
-- dostupný, aplikácia to robí poistne sama pri otvorení (public.tick()).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'matchday-process-due';
    perform cron.schedule('matchday-process-due', '*/10 * * * *', 'select private.process_due()');
    -- Upratovanie: staré pokusy o vstup a prečítané upozornenia staršie ako 90 dní.
    perform cron.unschedule(jobid) from cron.job where jobname = 'matchday-cleanup';
    perform cron.schedule('matchday-cleanup', '17 3 * * *',
      $job$delete from public.join_attempts where created_at < now() - interval '7 days';
           delete from public.notifications where read_at is not null and created_at < now() - interval '90 days'$job$);
  else
    raise notice 'pg_cron nie je dostupný – plánované upozornenia pobežia iba cez tick().';
  end if;
exception when others then
  raise notice 'pg_cron sa nepodarilo nastaviť: %', sqlerrm;
end $$;

-- Záznam o použitých migráciách, aby ich Supabase CLI neskôr nespustil druhýkrát.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261117100000', 'schema'),
  ('20261117100100', 'security'),
  ('20261117100200', 'rpc'),
  ('20261117100300', 'storage_cron')
on conflict (version) do nothing;

commit;
