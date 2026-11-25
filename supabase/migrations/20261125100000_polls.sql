-- MATCHDAY · Ankety na výber termínu
-- Ktorýkoľvek člen partie vytvorí anketu s možnosťami (napr. „Nedeľa ráno vonku“),
-- hráči hlasujú, a admin potom z vybranej možnosti vytvorí pevný termín.
-- Hlasy sú verejné v rámci partie (ako ankety vo WhatsAppe).

alter type public.notification_type add value if not exists 'new_poll';

create type public.poll_status as enum ('open', 'closed', 'converted');

create table public.polls (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  title          text not null check (char_length(title) between 2 and 100),
  note           text check (char_length(note) <= 300),
  allow_multiple boolean not null default true,
  status         public.poll_status not null default 'open',
  closes_at      timestamptz,
  match_id       uuid references public.matches (id) on delete set null,
  created_by     uuid references public.players (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index polls_group_idx on public.polls (group_id, created_at desc);

create table public.poll_options (
  id        uuid primary key default gen_random_uuid(),
  poll_id   uuid not null references public.polls (id) on delete cascade,
  label     text not null check (char_length(label) between 1 and 80),
  starts_at timestamptz,
  position  smallint not null default 0
);
create index poll_options_poll_idx on public.poll_options (poll_id, position);

create table public.poll_votes (
  poll_id    uuid not null references public.polls (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, player_id)
);
create index poll_votes_poll_idx on public.poll_votes (poll_id);
create index poll_votes_player_idx on public.poll_votes (player_id);

create or replace function private.poll_group(p_poll uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.polls where id = p_poll
$$;
revoke execute on function private.poll_group(uuid) from public, anon;
grant execute on function private.poll_group(uuid) to authenticated;

-- ───────────── RLS: čítanie pre partiu, zápis iba cez funkcie nižšie ─────────────
alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

create policy polls_select on public.polls for select to authenticated
  using (group_id = (select private.my_group_id()));
create policy poll_options_select on public.poll_options for select to authenticated
  using (private.poll_group(poll_id) = (select private.my_group_id()));
create policy poll_votes_select on public.poll_votes for select to authenticated
  using (private.poll_group(poll_id) = (select private.my_group_id()));

revoke all on public.polls, public.poll_options, public.poll_votes from anon, authenticated;
grant select on public.polls, public.poll_options, public.poll_votes to authenticated;

-- ───────────── Funkcie ─────────────
-- p_options = [{ "label": "Nedeľa ráno vonku", "starts_at": "2026-11-29T09:00:00Z" | null }, …]
create or replace function public.create_poll(
  p_title text, p_note text, p_options jsonb, p_allow_multiple boolean default true, p_closes_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := private.require_player();
  v_group uuid := private.my_group_id();
  v_id    uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 10
     or exists (select 1 from jsonb_array_elements(p_options) o
                where char_length(btrim(coalesce(o ->> 'label', ''))) not between 1 and 80) then
    raise exception 'invalid_options';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'invalid_deadline'; end if;
  if (select count(*) from public.polls where group_id = v_group and status = 'open') >= 10 then
    raise exception 'too_many_polls';
  end if;

  insert into public.polls (group_id, title, note, allow_multiple, closes_at, created_by)
  values (v_group, v_title, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_allow_multiple, true), p_closes_at, v_me)
  returning id into v_id;

  insert into public.poll_options (poll_id, label, starts_at, position)
  select v_id, btrim(o.value ->> 'label'), nullif(o.value ->> 'starts_at', '')::timestamptz, o.ord - 1
  from jsonb_array_elements(p_options) with ordinality as o(value, ord);

  perform private.notify(v_group, p.id, 'new_poll', 'Nová anketa: ' || v_title,
    'Hlasuj, ktorá možnosť ti vyhovuje.', '/terminy', 'new_poll:' || v_id)
  from public.players p
  where p.group_id = v_group and p.is_active and p.id <> v_me;

  return v_id;
end $$;

-- Nastaví MOJE hlasy v ankete (prázdne pole = zrušiť hlasovanie).
create or replace function public.vote_poll(p_poll uuid, p_options uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := private.require_player();
  v_poll public.polls;
  v_opts uuid[] := coalesce((select array_agg(distinct x) from unnest(p_options) x), '{}');
begin
  select * into v_poll from public.polls where id = p_poll and group_id = private.my_group_id();
  if not found then raise exception 'not_found'; end if;
  if v_poll.status <> 'open' or (v_poll.closes_at is not null and v_poll.closes_at <= now()) then
    raise exception 'poll_closed';
  end if;
  if not v_poll.allow_multiple and cardinality(v_opts) > 1 then raise exception 'single_choice'; end if;
  if exists (select 1 from unnest(v_opts) x
             where not exists (select 1 from public.poll_options o where o.id = x and o.poll_id = p_poll)) then
    raise exception 'invalid_options';
  end if;

  delete from public.poll_votes where poll_id = p_poll and player_id = v_me and not (option_id = any (v_opts));
  insert into public.poll_votes (poll_id, option_id, player_id)
  select p_poll, x, v_me from unnest(v_opts) x
  on conflict (option_id, player_id) do nothing;
end $$;

-- Uzavrieť / znova otvoriť anketu: autor alebo admin.
create or replace function public.set_poll_open(p_poll uuid, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := private.require_player();
  v_poll public.polls;
begin
  select * into v_poll from public.polls where id = p_poll and group_id = private.my_group_id() for update;
  if not found then raise exception 'not_found'; end if;
  if v_poll.created_by is distinct from v_me and not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_poll.status = 'converted' then raise exception 'poll_converted'; end if;
  update public.polls set
    status = case when p_open then 'open' else 'closed' end::public.poll_status,
    closes_at = case when p_open and closes_at <= now() then null else closes_at end
  where id = p_poll;
end $$;

-- Zmazať anketu: autor alebo admin. Termín vytvorený z ankety ostáva.
create or replace function public.delete_poll(p_poll uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := private.require_player();
  v_poll public.polls;
begin
  select * into v_poll from public.polls where id = p_poll and group_id = private.my_group_id();
  if not found then raise exception 'not_found'; end if;
  if v_poll.created_by is distinct from v_me and not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.polls where id = p_poll;
end $$;

-- Admin: z vybranej možnosti vytvorí pevný termín.
-- p = { starts_at, location?, note?, max_players?, signup_closes_at?, kind?, team_a_name?, team_b_name?, mark_attendance? }
-- Pri mark_attendance sa hráči, ktorí hlasovali za túto možnosť, prihlásia ako „Prídem“
-- (v poradí hlasovania, najviac do limitu termínu; ostatní ako „Možno“).
create or replace function public.create_event_from_poll(p_poll uuid, p_option uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := private.require_admin();
  v_group  uuid := private.my_group_id();
  v_poll   public.polls;
  v_season uuid;
  v_match  uuid;
  v_max    integer := nullif(p ->> 'max_players', '')::integer;
begin
  select * into v_poll from public.polls where id = p_poll and group_id = v_group for update;
  if not found then raise exception 'not_found'; end if;
  if v_poll.status = 'converted' then raise exception 'poll_converted'; end if;
  if not exists (select 1 from public.poll_options where id = p_option and poll_id = p_poll) then
    raise exception 'invalid_options';
  end if;
  select id into v_season from public.seasons where group_id = v_group and is_current;
  if v_season is null then raise exception 'no_season'; end if;

  insert into public.matches (
    group_id, season_id, starts_at, location, note, max_players, signup_closes_at,
    kind, team_a_name, team_b_name, created_by
  ) values (
    v_group, v_season,
    (p ->> 'starts_at')::timestamptz,
    nullif(btrim(coalesce(p ->> 'location', '')), ''),
    nullif(btrim(coalesce(p ->> 'note', '')), ''),
    v_max,
    nullif(p ->> 'signup_closes_at', '')::timestamptz,
    coalesce(nullif(p ->> 'kind', '')::public.match_kind, 'internal'),
    coalesce(nullif(btrim(p ->> 'team_a_name'), ''), 'Tím A'),
    coalesce(nullif(btrim(p ->> 'team_b_name'), ''), 'Tím B'),
    v_me
  ) returning id into v_match;

  if coalesce((p ->> 'mark_attendance')::boolean, false) then
    insert into public.attendance (match_id, player_id, status, updated_by)
    select v_match, v.player_id,
      case when v_max is null or row_number() over (order by v.created_at) <= v_max then 'yes' else 'maybe' end::public.attendance_status,
      v_me
    from public.poll_votes v
    join public.players pl on pl.id = v.player_id and pl.is_active
    where v.option_id = p_option;
  end if;

  update public.polls set status = 'converted', match_id = v_match where id = p_poll;
  return v_match;
end $$;

revoke execute on function
  public.create_poll(text, text, jsonb, boolean, timestamptz),
  public.vote_poll(uuid, uuid[]),
  public.set_poll_open(uuid, boolean),
  public.delete_poll(uuid),
  public.create_event_from_poll(uuid, uuid, jsonb)
from public, anon;
grant execute on function
  public.create_poll(text, text, jsonb, boolean, timestamptz),
  public.vote_poll(uuid, uuid[]),
  public.set_poll_open(uuid, boolean),
  public.delete_poll(uuid),
  public.create_event_from_poll(uuid, uuid, jsonb)
to authenticated;
