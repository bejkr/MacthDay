-- MATCHDAY · demo dáta IBA PRE LOKÁLNY VÝVOJ
-- Naplní prvú partiu v databáze hráčmi, zápasmi, termínmi a pokladnicou, aby bolo
-- vidieť obrazovky s údajmi. Predtým si v aplikácii založ partiu (/zalozit).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/dev-seed.sql
--
-- NIKDY nespúšťať na produkčnej databáze. Skript sa odmietne spustiť, ak partia
-- už má odohrané zápasy.
do $$
declare
  v_group   uuid;
  v_season  uuid;
  v_admin   uuid;
  v_match   uuid;
  v_ids     uuid[];
  v_a       uuid[];
  v_b       uuid[];
  v_sa      int;
  v_sb      int;
  i         int;
  g         int;
  v_scorer  uuid;
  v_assist  uuid;
  r         record;
begin
  select id into v_group from public.groups order by created_at limit 1;
  if v_group is null then raise exception 'Najprv založ partiu v aplikácii (/zalozit).'; end if;
  if exists (select 1 from public.matches where group_id = v_group and status = 'played') then
    raise exception 'Partia už má zápasy – demo dáta sa nepridajú.';
  end if;
  select id into v_season from public.seasons where group_id = v_group and is_current;
  select id into v_admin from public.players where group_id = v_group and role = 'admin' order by created_at limit 1;
  perform setseed(0.42);

  update public.players set joined_on = current_date - 70, position = 'MID', skill = 4, jersey_number = 8 where id = v_admin;
  update public.groups set max_players = greatest(max_players, 30) where id = v_group;

  for r in
    select * from (values
      ('Jano', 'ATT', 5, 9, '#B7F36B'), ('Fero', 'DEF', 3, 4, '#5AC9A8'), ('Peťo', 'GK', 4, 1, '#E8B65A'),
      ('Ďuro', 'MID', 3, 6, '#5AA9C9'), ('Kubo', 'ATT', 4, 11, '#F0906A'), ('Maroš', 'DEF', 2, 3, '#8B8DF0'),
      ('Riško', 'MID', 5, 10, '#C98BE8'), ('Tomáš', 'DEF', 3, 5, '#F06464'), ('Lukáš', 'ATT', 2, 17, '#8D9990')
    ) as t(nick, pos, skill, num, color)
  loop
    insert into public.players (group_id, nickname, position, skill, jersey_number, avatar_color, joined_on)
    values (v_group, r.nick, r.pos::public.player_position, r.skill, r.num, r.color, current_date - 70)
    on conflict do nothing;
  end loop;
  select array_agg(id order by random()) into v_ids from public.players where group_id = v_group;

  -- 6 odohraných zápasov, jeden týždenne
  for i in reverse 6..1 loop
    select array_agg(id order by random()) into v_ids from public.players where group_id = v_group;
    v_a := v_ids[1:5];
    v_b := v_ids[6:array_length(v_ids, 1) - (case when i % 3 = 0 then 1 else 0 end)];
    if not v_admin = any (v_a || v_b) then v_a[1] := v_admin; end if;
    v_sa := 2 + floor(random() * 5)::int;
    v_sb := 1 + floor(random() * 5)::int;

    insert into public.matches (group_id, season_id, status, starts_at, location, score_a, score_b, mvp_mode, created_by)
    values (v_group, v_season, 'played', date_trunc('day', now()) - make_interval(days => i * 7 - 2) + interval '18 hours',
            case when i % 2 = 0 then 'Umelka pri ZŠ' else 'Hala Pasienky' end, v_sa, v_sb, 'manual', v_admin)
    returning id into v_match;

    insert into public.match_player_stats (match_id, player_id, team) select v_match, x, 'A' from unnest(v_a) x;
    insert into public.match_player_stats (match_id, player_id, team) select v_match, x, 'B' from unnest(v_b) x;

    for g in 1..v_sa loop
      v_scorer := v_a[1 + floor(random() * random() * array_length(v_a, 1))::int];
      v_assist := v_a[1 + floor(random() * array_length(v_a, 1))::int];
      insert into public.match_goals (match_id, team, scorer_id, assist_id, seq)
      values (v_match, 'A', v_scorer, case when v_assist <> v_scorer and random() < 0.7 then v_assist end, g);
    end loop;
    for g in 1..v_sb loop
      v_scorer := v_b[1 + floor(random() * random() * array_length(v_b, 1))::int];
      v_assist := v_b[1 + floor(random() * array_length(v_b, 1))::int];
      insert into public.match_goals (match_id, team, scorer_id, assist_id, seq)
      values (v_match, 'B', v_scorer, case when v_assist <> v_scorer and random() < 0.7 then v_assist end, v_sa + g);
    end loop;

    if i = 1 then
      -- posledný zápas: MVP hlasovanie ešte beží
      update public.matches set mvp_mode = 'vote', mvp_voting_closes_at = now() + interval '20 hours' where id = v_match;
      insert into public.mvp_votes (match_id, voter_id, candidate_id)
        select v_match, s.player_id, (select scorer_id from public.match_goals where match_id = v_match and scorer_id <> s.player_id order by random() limit 1)
        from public.match_player_stats s where s.match_id = v_match and s.player_id <> v_admin limit 4;
      perform private.notify(v_group, v_admin, 'mvp_open', 'Hlasuj za MVP zápasu', 'Hlasovanie je otvorené 24 h.', '/zapasy/' || v_match, 'mvp_open:' || v_match);
    else
      update public.matches set mvp_finalized_at = starts_at + interval '1 day',
        mvp_player_id = (select scorer_id from public.match_goals where match_id = v_match group by scorer_id order by count(*) desc, random() limit 1)
      where id = v_match;
    end if;
  end loop;

  -- 2 nadchádzajúce termíny
  insert into public.matches (group_id, season_id, starts_at, location, note, max_players, signup_closes_at, created_by)
  values (v_group, v_season, date_trunc('day', now()) + interval '2 days 18 hours', 'Umelka pri ZŠ', 'Prineste si svetlé aj tmavé tričko. Hala 4 € na hlavu.', 12,
          date_trunc('day', now()) + interval '2 days 12 hours', v_admin)
  returning id into v_match;
  insert into public.attendance (match_id, player_id, status)
    select v_match, id, (array['yes', 'yes', 'yes', 'yes', 'maybe', 'no', 'yes'])[1 + (row_number() over (order by random()))::int % 7]::public.attendance_status
    from public.players where group_id = v_group and id <> v_admin
    order by random() limit 8;
  insert into public.matches (group_id, season_id, starts_at, location, kind, team_a_name, team_b_name, created_by)
  values (v_group, v_season, date_trunc('day', now()) + interval '9 days 19 hours', 'Štadión Rapid', 'external', (select left(name, 30) from public.groups where id = v_group), 'FC Kolegovia', v_admin);

  -- Pokladnica
  insert into public.treasury_entries (group_id, player_id, type, amount, entry_date, note, created_by)
    select v_group, id, 'contribution', 20, current_date - 40, 'Sezónny príspevok – jeseň', v_admin from public.players where group_id = v_group;
  insert into public.treasury_entries (group_id, player_id, type, amount, entry_date, note, created_by)
    select v_group, id, 'payment', 20, current_date - 30 + (row_number() over ())::int, 'Prevodom', v_admin
    from public.players where group_id = v_group order by random() limit 6;
  insert into public.treasury_entries (group_id, player_id, type, amount, entry_date, note, created_by) values
    (v_group, v_ids[2], 'fine', 5, current_date - 12, 'Neskorý príchod', v_admin),
    (v_group, v_ids[3], 'fine', 3, current_date - 5, 'Zabudnutý dres', v_admin),
    (v_group, v_admin, 'fine', 2, current_date - 5, 'Neospravedlnená neúčasť', v_ids[2]),
    (v_group, null, 'expense', 45, current_date - 20, 'Dve lopty Select', v_admin),
    (v_group, null, 'expense', 60, current_date - 9, 'Prenájom haly – november', v_admin),
    (v_group, null, 'income', 50, current_date - 25, 'Sponzor: krčma U Lipy', v_admin);

  raise notice 'Demo dáta pridané do partie %.', v_group;
end $$;
