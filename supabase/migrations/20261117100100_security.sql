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
