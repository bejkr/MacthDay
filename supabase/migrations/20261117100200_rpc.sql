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
