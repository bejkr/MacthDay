-- MATCHDAY · Viac zápasov za jeden večer
-- Termín (matches) je odteraz „hrací večer“. V ňom môže byť ľubovoľný počet
-- zápasov (games), každý so svojou zostavou, skóre a gólmi. MVP sa hlasuje raz
-- za večer, dochádzka sa počíta z večerov, výhry/góly/odohrané zápasy zo zápasov.

create table public.games (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  seq        smallint not null check (seq between 1 and 30),
  score_a    smallint not null check (score_a between 0 and 99),
  score_b    smallint not null check (score_b between 0 and 99),
  created_at timestamptz not null default now(),
  unique (match_id, seq)
);
create index games_match_idx on public.games (match_id);

alter table public.match_player_stats add column game_id uuid references public.games (id) on delete cascade;
alter table public.match_goals        add column game_id uuid references public.games (id) on delete cascade;
create index match_player_stats_game_idx on public.match_player_stats (game_id);
create index match_goals_game_idx on public.match_goals (game_id);

-- Doterajšie odohrané zápasy = večer s jedným zápasom
insert into public.games (match_id, seq, score_a, score_b)
select id, 1, score_a, score_b from public.matches
where status = 'played' and score_a is not null and score_b is not null;

update public.match_player_stats s set game_id = g.id
from public.games g where g.match_id = s.match_id;
update public.match_goals x set game_id = g.id
from public.games g where g.match_id = x.match_id;

-- Hráč môže byť v jednom večere vo viacerých zápasoch. Plánovaná zostava
-- k termínu (bez game_id) ostáva jedna na hráča.
alter table public.match_player_stats drop constraint if exists match_player_stats_match_id_player_id_key;
create unique index match_player_stats_game_player_uq on public.match_player_stats (game_id, player_id) where game_id is not null;
create unique index match_player_stats_plan_player_uq on public.match_player_stats (match_id, player_id) where game_id is null;

-- Výsledok večera je v games; skóre v matches sa vypĺňa len pri jedinom zápase.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.matches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%score_a IS NOT NULL%'
  loop
    execute format('alter table public.matches drop constraint %I', c);
  end loop;
end $$;

alter table public.games enable row level security;
create policy games_select on public.games for select to authenticated
  using (private.match_group(match_id) = (select private.my_group_id()));
revoke all on public.games from anon, authenticated;
grant select on public.games to authenticated;

-- ═════════ Zápis výsledku večera ═════════
-- p = { starts_at?, season_id?, location?, kind, team_a_name, team_b_name, result_note?,
--       mvp_mode, mvp_player_id?,
--       games: [{ score_a, score_b, lineup: [{player_id, team}], goals: [{team, scorer_id, assist_id?, is_own_goal?}] }] }
-- Starší tvar s score_a/score_b/lineup/goals priamo v p sa berie ako večer s jedným zápasom.
create or replace function public.save_match_result(p_match uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := private.require_admin();
  v_group  uuid := private.my_group_id();
  v_m      public.matches;
  v_mode   public.mvp_mode := coalesce(p ->> 'mvp_mode', 'vote')::public.mvp_mode;
  v_mvp    uuid := nullif(p ->> 'mvp_player_id', '')::uuid;
  v_games  jsonb;
  v_game   jsonb;
  v_lineup jsonb;
  v_goals  jsonb;
  v_seq    integer := 0;
  v_gid    uuid;
  v_sa     integer;
  v_sb     integer;
  v_hours  integer;
begin
  v_games := case when p ? 'games' then p -> 'games'
    else jsonb_build_array(jsonb_build_object(
      'score_a', p -> 'score_a', 'score_b', p -> 'score_b',
      'lineup', coalesce(p -> 'lineup', '[]'::jsonb), 'goals', coalesce(p -> 'goals', '[]'::jsonb)))
  end;
  if jsonb_typeof(v_games) <> 'array' or jsonb_array_length(v_games) not between 1 and 30 then
    raise exception 'invalid_games';
  end if;

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

  delete from public.match_goals where match_id = v_m.id;
  delete from public.match_player_stats where match_id = v_m.id;
  delete from public.games where match_id = v_m.id;

  for v_game in select value from jsonb_array_elements(v_games) loop
    v_seq := v_seq + 1;
    v_sa := (v_game ->> 'score_a')::integer;
    v_sb := (v_game ->> 'score_b')::integer;
    v_lineup := coalesce(v_game -> 'lineup', '[]'::jsonb);
    v_goals := coalesce(v_game -> 'goals', '[]'::jsonb);
    if v_sa is null or v_sb is null then raise exception 'invalid_score'; end if;
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

    insert into public.games (match_id, seq, score_a, score_b) values (v_m.id, v_seq, v_sa, v_sb)
    returning id into v_gid;

    insert into public.match_player_stats (match_id, game_id, player_id, team)
      select v_m.id, v_gid, l.player_id, l.team
      from jsonb_to_recordset(v_lineup) as l(player_id uuid, team public.team_side);

    insert into public.match_goals (match_id, game_id, team, scorer_id, assist_id, is_own_goal, seq)
      select v_m.id, v_gid,
             (t.g ->> 'team')::public.team_side,
             (t.g ->> 'scorer_id')::uuid,
             nullif(t.g ->> 'assist_id', '')::uuid,
             coalesce((t.g ->> 'is_own_goal')::boolean, false),
             t.ord
      from jsonb_array_elements(v_goals) with ordinality as t(g, ord);

    if exists (
      select 1 from public.match_goals g
      left join public.match_player_stats s on s.game_id = g.game_id and s.player_id = g.scorer_id
      where g.game_id = v_gid
        and (s.id is null
             or (not g.is_own_goal and s.team <> g.team)
             or (g.is_own_goal and s.team = g.team))
    ) then
      raise exception 'scorer_not_in_team';
    end if;
    if exists (
      select 1 from public.match_goals g
      left join public.match_player_stats s on s.game_id = g.game_id and s.player_id = g.assist_id
      where g.game_id = v_gid and g.assist_id is not null and (s.id is null or s.team <> g.team)
    ) then
      raise exception 'assist_not_in_team';
    end if;
    if (select count(*) from public.match_goals where game_id = v_gid and team = 'A') > v_sa
       or (select count(*) from public.match_goals where game_id = v_gid and team = 'B') > v_sb then
      raise exception 'goals_exceed_score';
    end if;
  end loop;

  update public.matches set
    status      = 'played',
    kind        = coalesce(nullif(p ->> 'kind', '')::public.match_kind, kind),
    starts_at   = coalesce((p ->> 'starts_at')::timestamptz, starts_at),
    season_id   = coalesce(nullif(p ->> 'season_id', '')::uuid, season_id),
    location    = case when p ? 'location' then nullif(p ->> 'location', '') else location end,
    team_a_name = coalesce(nullif(btrim(p ->> 'team_a_name'), ''), team_a_name),
    team_b_name = coalesce(nullif(btrim(p ->> 'team_b_name'), ''), team_b_name),
    -- pri jedinom zápase ostáva skóre aj v matches (kvôli prehľadnosti a starším výpisom)
    score_a     = case when v_seq = 1 then v_sa end,
    score_b     = case when v_seq = 1 then v_sb end,
    result_note = nullif(p ->> 'result_note', ''),
    signup_closes_at = least(signup_closes_at, coalesce((p ->> 'starts_at')::timestamptz, starts_at))
  where id = v_m.id;

  -- MVP za celý večer: kandidáti a voliči sú všetci, čo hrali aspoň jeden zápas.
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
      select mvp_vote_hours into v_hours from public.groups where id = v_group;
      update public.matches set mvp_mode = 'vote', mvp_player_id = null,
        mvp_voting_closes_at = now() + make_interval(hours => v_hours), mvp_finalized_at = null
      where id = v_m.id;
      perform private.notify(v_group, s.player_id, 'mvp_open', 'Hlasuj za MVP večera',
        'Hlasovanie je otvorené ' || v_hours || ' h. Vyber najlepšieho hráča večera.',
        '/zapasy/' || v_m.id, 'mvp_open:' || v_m.id)
      from (select distinct player_id from public.match_player_stats where match_id = v_m.id) s;
    else
      delete from public.mvp_votes v
      where v.match_id = v_m.id and (
        not exists (select 1 from public.match_player_stats s where s.match_id = v_m.id and s.player_id = v.voter_id)
        or not exists (select 1 from public.match_player_stats s where s.match_id = v_m.id and s.player_id = v.candidate_id)
      );
    end if;
  end if;

  return v_m.id;
end $$;

-- ═════════ MVP: počet voličov = hráči večera (každý raz) ═════════
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
    'voters', (select count(distinct player_id) from public.match_player_stats where match_id = p_match),
    'tally', case when v_closed and v_m.mvp_mode = 'vote' then coalesce((
      select jsonb_agg(jsonb_build_object('player_id', t.candidate_id, 'votes', t.votes) order by t.votes desc)
      from (select candidate_id, count(*) as votes from public.mvp_votes where match_id = p_match group by candidate_id) t
    ), '[]'::jsonb) end
  );
end $$;

-- ═════════ Štatistiky ═════════
-- matches_played / wins / draws / losses = jednotlivé zápasy;
-- eligible_matches / attendance_pct = hracie večery (dochádzka).
create or replace function public.player_stats(p_season uuid default null)
returns table (
  player_id uuid, matches_played integer, goals integer, assists integer, mvps integer,
  wins integer, draws integer, losses integer, eligible_matches integer, attendance_pct integer
) language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, starts_at, mvp_player_id
    from public.matches
    where status = 'played'
      and group_id = (select private.my_group_id())
      and (p_season is null or season_id = p_season)
  ),
  gm as (
    select g.id, g.score_a, g.score_b from public.games g join m on m.id = g.match_id
  ),
  pl as (
    select s.player_id,
      count(*)::integer as matches_played,
      count(*) filter (where (s.team = 'A' and gm.score_a > gm.score_b) or (s.team = 'B' and gm.score_b > gm.score_a))::integer as wins,
      count(*) filter (where gm.score_a = gm.score_b)::integer as draws,
      count(*) filter (where (s.team = 'A' and gm.score_a < gm.score_b) or (s.team = 'B' and gm.score_b < gm.score_a))::integer as losses
    from public.match_player_stats s join gm on gm.id = s.game_id
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
  att as (
    select distinct match_id, player_id from public.match_player_stats where game_id is not null
  ),
  e as (
    select p.id as pid, count(m.id)::integer as eligible, count(att.match_id)::integer as attended
    from public.players p
    left join m on (m.starts_at at time zone 'Europe/Bratislava')::date >= p.joined_on
    left join att on att.match_id = m.id and att.player_id = p.id
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

-- História hráča po zápasoch. MVP večera sa označí pri jeho poslednom zápase v ten večer.
drop function if exists public.player_history(uuid, uuid);
create function public.player_history(p_player uuid, p_season uuid default null)
returns table (
  match_id uuid, game_id uuid, game_seq integer, games_in_match integer, starts_at timestamptz,
  team public.team_side, team_a_name text, team_b_name text,
  score_a smallint, score_b smallint, goals integer, assists integer, is_mvp boolean
) language sql stable security invoker set search_path = '' as $$
  select m.id, gm.id, gm.seq::integer,
    (select count(*)::integer from public.games x where x.match_id = m.id),
    m.starts_at, s.team, m.team_a_name, m.team_b_name, gm.score_a, gm.score_b,
    (select count(*)::integer from public.match_goals g where g.game_id = gm.id and g.scorer_id = p_player and not g.is_own_goal),
    (select count(*)::integer from public.match_goals g where g.game_id = gm.id and g.assist_id = p_player),
    coalesce(m.mvp_player_id = p_player, false) and gm.seq = (
      select max(g2.seq) from public.match_player_stats s2 join public.games g2 on g2.id = s2.game_id
      where s2.match_id = m.id and s2.player_id = p_player
    )
  from public.match_player_stats s
  join public.games gm on gm.id = s.game_id
  join public.matches m on m.id = s.match_id
  where s.player_id = p_player and m.status = 'played'
    and m.group_id = (select private.my_group_id())
    and (p_season is null or m.season_id = p_season)
  order by m.starts_at, gm.seq
$$;
revoke execute on function public.player_history(uuid, uuid) from public, anon;
grant execute on function public.player_history(uuid, uuid) to authenticated;

-- Súhrn partie: večery, góly zo všetkých zápasov, priemerný počet hráčov na večer.
create or replace function public.group_summary(p_season uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with m as (
    select id, kind from public.matches
    where status = 'played' and group_id = (select private.my_group_id())
      and (p_season is null or season_id = p_season)
  ),
  sizes as (
    select m.id, count(distinct s.player_id) as n
    from m left join public.match_player_stats s on s.match_id = m.id
    group by m.id
  )
  select jsonb_build_object(
    'matches_played', (select count(*) from m),
    'games_played', (select count(*) from public.games g join m on m.id = g.match_id),
    'total_goals', (select coalesce(sum(g.score_a + case when m.kind = 'internal' then g.score_b else 0 end), 0)
                    from public.games g join m on m.id = g.match_id),
    'avg_players', (select round(avg(n), 1) from sizes),
    'avg_attendance_pct', (
      select round(avg(attendance_pct)) from public.player_stats(p_season) ps
      join public.players p on p.id = ps.player_id
      where p.is_active and p.deleted_at is null and ps.attendance_pct is not null
    )
  )
$$;
