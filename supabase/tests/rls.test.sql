-- MATCHDAY · testy RLS a bezpečnostných pravidiel
-- Simuluje viac zariadení (anonymných Supabase identít) a overuje, čo ktoré smie.
-- Beží v jednej transakcii a na konci sa celý vráti späť (ROLLBACK).
-- Spustenie:  bash scripts/test-db.sh      (čistý Postgres)
--        alebo psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql  (lokálny Supabase)

begin;

create schema t;
create table t.vars (k text primary key, v text);

create function t.set(p_k text, p_v text) returns void language sql security definer as $$
  insert into t.vars values (p_k, p_v) on conflict (k) do update set v = excluded.v
$$;
create function t.get(p_k text) returns text language sql security definer as $$
  select v from t.vars where k = p_k
$$;
create function t.uid(p_k text) returns uuid language sql security definer as $$
  select v::uuid from t.vars where k = p_k
$$;
-- Prepne "prihláseného používateľa" na danú identitu (rola authenticated + JWT sub).
create function t.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', t.get(p_user))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function t.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $$;
create function t.root() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'postgres', true);
end $$;
create function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'TEST ZLYHAL: %', p_msg; end if;
  perform set_config('t.count', (coalesce(nullif(current_setting('t.count', true), ''), '0')::int + 1)::text, true);
end $$;
-- Očakáva, že príkaz skončí chybou obsahujúcou p_expect.
create function t.throws(p_sql text, p_expect text, p_msg text) returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then raise exception 'TEST ZLYHAL: % (príkaz prešiel, čakala sa chyba „%“)', p_msg, p_expect; end if;
  if position(p_expect in v_err) = 0 then raise exception 'TEST ZLYHAL: % (chyba „%“, čakala sa „%“)', p_msg, v_err, p_expect; end if;
  perform set_config('t.count', (coalesce(nullif(current_setting('t.count', true), ''), '0')::int + 1)::text, true);
end $$;
-- Koľko riadkov zmenil príkaz (RLS tiché odfiltrovanie = 0).
create function t.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- Identity (zariadenia)
do $$
declare k text;
begin
  foreach k in array array['admin', 'jano', 'fero', 'stranger', 'rejected', 'newphone', 'other', 'spammer'] loop
    with u as (insert into auth.users default values returning id)
    insert into t.vars select k, id::text from u;
  end loop;
end $$;

-- ═════════ 1. Založenie partie ═════════
do $$
begin
  perform t.anon();
  perform t.ok(public.setup_open(), 'anon: setup_open je dostupné a true');
  perform t.throws('select * from public.players', 'permission denied', 'anon nemá prístup k tabuľkám');
  perform t.throws('select public.whoami()', 'permission denied', 'anon nesmie volať whoami');

  perform t.login('admin');
  perform t.ok((public.whoami() ->> 'state') = 'guest', 'nová identita je guest');
  perform t.set('g1', public.create_group('FC Test', '  Boss  ', '2026')::text);
  perform t.ok((public.whoami() -> 'player' ->> 'role') = 'admin', 'zakladateľ je admin');
  perform t.ok((public.whoami() -> 'player' ->> 'nickname') = 'Boss', 'prezývka je orezaná');
  perform t.ok(not public.setup_open(), 'po založení je setup zatvorený');
  perform t.throws('select public.create_group(''X Y'', ''Dup'', null)', 'already_member', 'člen nemôže založiť druhú partiu');

  perform t.login('other');
  perform t.throws('select public.create_group(''Cudzia'', ''Hacker'', null)', 'setup_closed', 'druhá partia sa nedá založiť (max_groups = 1)');

  perform t.root();
  update public.app_config set max_groups = 2;
  perform t.login('other');
  perform t.set('g2', public.create_group('Druhá partia', 'Šéf', null)::text);
end $$;

-- ═════════ 2. Pozývací link ═════════
do $$
declare v_token text; r jsonb;
begin
  perform t.login('jano');
  perform t.throws('select public.create_invite_link()', 'forbidden', 'ne-člen nevytvorí pozvánku');

  perform t.login('admin');
  v_token := public.create_invite_link();
  perform t.set('token', v_token);
  perform t.ok(char_length(v_token) = 64, 'token má 64 znakov');
  perform t.ok(not exists (select 1 from public.invite_links where token_hash = v_token), 'token nie je uložený v čitateľnej podobe');
  perform t.ok((select token_hash from public.invite_links where revoked_at is null) = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), 'uložený je SHA-256 hash');

  perform t.anon();
  perform t.ok((public.peek_invite(v_token) ->> 'group_name') = 'FC Test', 'peek_invite ukáže názov partie');
  perform t.ok((public.peek_invite('zly-token') ->> 'valid') = 'false', 'neplatný token nič neprezradí');

  perform t.login('jano');
  r := public.join_group(v_token, 'Jano', 'iPhone');
  perform t.ok(r ->> 'status' = 'joined', 'nová prezývka → okamžitý vstup');
  perform t.ok((public.whoami() -> 'player' ->> 'role') = 'player', 'nový hráč nie je admin');
  perform t.set('p_jano', public.whoami() -> 'player' ->> 'id');

  perform t.login('fero');
  r := public.join_group(v_token, 'Fero', 'Android');
  perform t.ok(r ->> 'status' = 'joined', 'druhý hráč vstúpil');
  perform t.set('p_fero', public.whoami() -> 'player' ->> 'id');
  perform t.ok((select count(*) from public.players) = 3, 'hráč vidí 3 hráčov svojej partie (a nikoho z cudzej)');
end $$;

-- ═════════ 3. Existujúca prezývka NEDÁVA prístup ═════════
do $$
declare r jsonb; v_req uuid;
begin
  perform t.login('stranger');
  r := public.join_group(t.get('token'), 'jANO', 'Neznámy mobil');
  perform t.ok(r ->> 'status' = 'pending', 'existujúca prezývka (aj inou veľkosťou písmen) → čakajúca žiadosť');
  perform t.ok(public.whoami() ->> 'state' = 'pending', 'whoami hlási pending');
  perform t.ok((select count(*) from public.players) = 0, 'čakajúci nevidí hráčov');
  perform t.ok((select count(*) from public.groups) = 0, 'čakajúci nevidí partiu');
  perform t.ok((select count(*) from public.access_requests) = 1, 'čakajúci vidí iba svoju žiadosť');
  perform t.throws('select public.decide_access_request((select id from public.access_requests limit 1), true)', 'forbidden', 'žiadateľ si žiadosť neschváli sám');
  perform t.throws('insert into public.player_devices (player_id, auth_user_id) values (''' || t.get('p_jano') || ''', auth.uid())', 'permission denied', 'priamy zápis zariadenia je zakázaný');

  perform t.login('rejected');
  r := public.join_group(t.get('token'), 'Fero', null);
  perform t.ok(r ->> 'status' = 'pending', 'druhá žiadosť čaká');

  perform t.login('fero');
  perform t.ok((select count(*) from public.access_requests) = 0, 'bežný hráč nevidí cudzie žiadosti');
  perform t.throws('select public.decide_access_request(gen_random_uuid(), true)', 'forbidden', 'bežný hráč neschvaľuje žiadosti');

  perform t.login('admin');
  perform t.ok((select count(*) from public.access_requests where status = 'pending') = 2, 'admin vidí 2 čakajúce žiadosti');
  perform t.ok((select count(*) from public.notifications where type = 'access_request') = 2, 'admin dostal upozornenia o žiadostiach');
  select id into v_req from public.access_requests where auth_user_id = t.uid('stranger');
  perform public.decide_access_request(v_req, true);
  select id into v_req from public.access_requests where auth_user_id = t.uid('rejected');
  perform public.decide_access_request(v_req, false);

  perform t.login('stranger');
  perform t.ok((public.whoami() -> 'player' ->> 'id') = t.get('p_jano'), 'po schválení je zariadenie prepojené s Janom');
  perform t.login('rejected');
  perform t.ok(public.whoami() ->> 'state' = 'rejected', 'zamietnutý ostáva vonku');
  perform t.ok((select count(*) from public.players) = 0, 'zamietnutý nevidí nič');
end $$;

-- ═════════ 4. Rate limiting a neplatné linky ═════════
do $$
declare r jsonb; i int;
begin
  perform t.login('spammer');
  for i in 1..8 loop
    r := public.join_group('nespravny-token-' || i, 'Spam', null);
    perform t.ok(r ->> 'code' = 'invalid_link', 'neplatný token odmietnutý');
  end loop;
  r := public.join_group(t.get('token'), 'Spam', null);
  perform t.ok(r ->> 'code' = 'rate_limited', '9. pokus za hodinu je zablokovaný aj s platným tokenom');
  perform t.throws('select * from public.join_attempts', 'permission denied', 'záznam pokusov nie je čitateľný z klienta');
end $$;

-- ═════════ 5. Hráč si nevie zvýšiť oprávnenia ═════════
do $$
begin
  perform t.login('jano');
  perform t.ok(t.affected('update public.players set role = ''admin'' where id = ''' || t.get('p_jano') || '''') = 0, 'hráč si nenastaví rolu admin (RLS → 0 riadkov)');
  perform t.ok(t.affected('update public.players set skill = 5') = 0, 'hráč neupraví hodnotenia');
  perform t.ok(t.affected('update public.groups set name = ''Hacked''') = 0, 'hráč neupraví partiu');
  perform t.throws('update public.players set group_id = ''' || t.get('g2') || '''', 'permission denied', 'group_id sa nedá meniť');
  perform t.throws('insert into public.players (group_id, nickname) values (''' || t.get('g1') || ''', ''Fake'')', 'row-level security', 'hráč nevytvorí hráča');
  perform t.throws('insert into public.matches (group_id, season_id, starts_at) select group_id, id, now() from public.seasons', 'row-level security', 'hráč nevytvorí termín');
  perform t.throws('insert into public.treasury_entries (group_id, player_id, type, amount, created_by) values (''' || t.get('g1') || ''', ''' || t.get('p_jano') || ''', ''payment'', 100, ''' || t.get('p_jano') || ''')', 'row-level security', 'hráč nezapíše platbu');
  perform t.throws('insert into public.attendance (match_id, player_id, status) values (gen_random_uuid(), gen_random_uuid(), ''yes'')', 'permission denied', 'dochádzka sa nedá zapísať priamo');
  perform t.throws('insert into public.mvp_votes (match_id, voter_id, candidate_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())', 'permission denied', 'hlas sa nedá zapísať priamo');
  perform t.throws('insert into public.notifications (group_id, player_id, type, title) values (gen_random_uuid(), gen_random_uuid(), ''system'', ''x'')', 'permission denied', 'upozornenie sa nedá podvrhnúť');
  perform t.throws('select public.start_new_season(''Hack'')', 'forbidden', 'hráč nezačne sezónu');
  perform t.throws('select public.revoke_invite_link(gen_random_uuid())', 'forbidden', 'hráč nezruší pozvánku');
  perform t.ok((select count(*) from public.invite_links) = 0, 'hráč nevidí pozvánky');
  perform t.ok((select count(*) from public.player_devices) = 1, 'hráč vidí iba svoje zariadenie');
  perform t.throws('select private.process_due()', 'permission denied', 'interné funkcie nie sú volateľné');
  perform t.throws('select private.notify(null, null, ''system'', ''x'', ''y'', null)', 'permission denied', 'private.notify nie je volateľné');
end $$;

-- ═════════ 6. Termín a dochádzka ═════════
do $$
declare v_match uuid; v_admin uuid;
begin
  perform t.login('admin');
  v_admin := (public.whoami() -> 'player' ->> 'id')::uuid;
  perform t.set('p_admin', v_admin::text);
  perform t.set('s1', (select id::text from public.seasons));
  insert into public.matches (group_id, season_id, starts_at, location, max_players, created_by)
    select group_id, id, now() + interval '2 days', 'Štadión', 2, v_admin from public.seasons
    returning id into v_match;
  perform t.set('m1', v_match::text);

  perform t.login('jano');
  perform t.ok((select count(*) from public.notifications where type = 'new_event') = 1, 'hráč dostal upozornenie na nový termín');
  perform public.set_attendance(v_match, 'yes');
  perform t.throws('select public.admin_set_attendance(''' || v_match || ''', ''' || t.get('p_fero') || ''', ''no'')', 'forbidden', 'hráč nemení cudziu dochádzku');
  perform public.set_attendance(v_match, 'maybe');
  perform public.set_attendance(v_match, 'yes');
  perform t.ok((select count(*) from public.attendance where match_id = v_match) = 1, 'zmena odpovede neprodukuje duplicity');

  perform t.login('fero');
  perform public.set_attendance(v_match, 'yes');
  perform t.ok((select count(*) from public.attendance where match_id = v_match) = 2, 'hráč vidí dochádzku partie');

  perform t.login('admin');
  perform t.throws('select public.set_attendance(''' || v_match || ''', ''yes'')', 'match_full', 'kapacita termínu sa nedá prekročiť');
  perform public.set_attendance(v_match, 'no');
  update public.matches set signup_closes_at = now() - interval '1 minute' where id = v_match;

  perform t.login('jano');
  perform t.throws('select public.set_attendance(''' || v_match || ''', ''no'')', 'signup_closed', 'po uzávierke sa hráč neprepíše');
  perform t.login('admin');
  perform public.admin_set_attendance(v_match, t.uid('p_jano'), 'no');
  perform t.ok((select status from public.attendance where match_id = v_match and player_id = t.uid('p_jano')) = 'no', 'admin opraví dochádzku aj po uzávierke');
  perform public.admin_set_attendance(v_match, t.uid('p_jano'), 'yes');
end $$;

-- ═════════ 7. Zostava, výsledok, štatistiky ═════════
do $$
declare v_match uuid := t.uid('m1'); v_payload jsonb; s record;
begin
  perform t.login('jano');
  perform t.throws('select public.save_lineup(''' || v_match || ''', array[]::uuid[], array[]::uuid[])', 'forbidden', 'hráč neukladá zostavy');
  perform t.throws('select public.save_match_result(''' || v_match || ''', ''{"score_a":9,"score_b":0}'')', 'forbidden', 'hráč nezapisuje výsledok');

  perform t.login('admin');
  perform public.save_lineup(v_match, array[t.uid('p_admin'), t.uid('p_jano')], array[t.uid('p_fero')]);
  perform t.ok((select count(*) from public.match_player_stats where match_id = v_match) = 3, 'zostava uložená k termínu');

  v_payload := jsonb_build_object(
    'score_a', 3, 'score_b', 1, 'mvp_mode', 'vote',
    'lineup', jsonb_build_array(
      jsonb_build_object('player_id', t.get('p_admin'), 'team', 'A'),
      jsonb_build_object('player_id', t.get('p_jano'), 'team', 'A'),
      jsonb_build_object('player_id', t.get('p_fero'), 'team', 'B')),
    'goals', jsonb_build_array(
      jsonb_build_object('team', 'A', 'scorer_id', t.get('p_jano'), 'assist_id', t.get('p_admin')),
      jsonb_build_object('team', 'A', 'scorer_id', t.get('p_jano')),
      jsonb_build_object('team', 'A', 'scorer_id', t.get('p_fero'), 'is_own_goal', true),
      jsonb_build_object('team', 'B', 'scorer_id', t.get('p_fero'))));

  perform t.throws(format('select public.save_match_result(%L, %L)', v_match, v_payload || '{"score_a":2}'), 'goals_exceed_score', 'viac gólov ako skóre sa neuloží');
  perform t.throws(format('select public.save_match_result(%L, %L)', v_match,
    v_payload || jsonb_build_object('goals', jsonb_build_array(jsonb_build_object('team', 'B', 'scorer_id', t.get('p_jano'))))),
    'scorer_not_in_team', 'strelec musí byť z daného tímu');
  perform t.ok((select status from public.matches where id = v_match) = 'scheduled', 'neúspešný zápis nič nezmenil (transakcia)');

  perform public.save_match_result(v_match, v_payload);
  perform t.ok((select status from public.matches where id = v_match) = 'played', 'zápas je odohraný');
  perform t.ok((select mvp_voting_closes_at > now() from public.matches where id = v_match), 'MVP hlasovanie je otvorené');

  select * into s from public.player_stats() where player_id = t.uid('p_jano');
  perform t.ok(s.goals = 2 and s.assists = 0 and s.matches_played = 1 and s.wins = 1, 'štatistiky Jana: 2 góly, 1 výhra');
  select * into s from public.player_stats() where player_id = t.uid('p_admin');
  perform t.ok(s.assists = 1 and s.goals = 0, 'asistencia sa počíta');
  select * into s from public.player_stats() where player_id = t.uid('p_fero');
  perform t.ok(s.goals = 1 and s.losses = 1 and s.attendance_pct = 100, 'vlastný gól sa nepočíta strelcovi; dochádzka 100 %');
  perform t.ok((public.group_summary() ->> 'total_goals')::int = 4, 'spolu 4 góly');

  perform t.login('fero');
  perform t.ok((select count(*) from public.notifications where type = 'mvp_open') = 1, 'upozornenie na otvorené hlasovanie');
  perform t.ok((select count(*) from public.player_history(t.uid('p_jano'))) = 1, 'história výkonov je čitateľná pre spoluhráča');
end $$;

-- ═════════ 8. MVP hlasovanie ═════════
do $$
declare v_match uuid := t.uid('m1'); st jsonb;
begin
  perform t.login('jano');
  perform t.throws(format('select public.cast_mvp_vote(%L, %L)', v_match, t.get('p_jano')), 'self_vote', 'nedá sa hlasovať za seba');
  perform public.cast_mvp_vote(v_match, t.uid('p_fero'));
  perform t.throws(format('select public.cast_mvp_vote(%L, %L)', v_match, t.get('p_admin')), 'already_voted', 'nedá sa hlasovať dvakrát');

  perform t.login('fero');
  perform t.ok((select count(*) from public.mvp_votes) = 0, 'cudzie hlasy nie sú viditeľné (tajné hlasovanie)');
  st := public.mvp_status(v_match);
  perform t.ok(st -> 'tally' = 'null'::jsonb and (st ->> 'votes_cast')::int = 1, 'počas hlasovania je vidieť iba počet hlasov');
  perform public.cast_mvp_vote(v_match, t.uid('p_jano'));

  perform t.login('admin');
  perform public.cast_mvp_vote(v_match, t.uid('p_jano'));
  perform t.ok((select count(*) from public.mvp_votes) = 1, 'ani admin nevidí cudzie hlasy');

  perform t.root();
  update public.matches set mvp_voting_closes_at = now() - interval '1 minute' where id = v_match;

  perform t.login('fero');
  perform public.tick();
  perform t.ok((select mvp_player_id from public.matches where id = v_match) = t.uid('p_jano'), 'víťaz hlasovania je zapísaný');
  st := public.mvp_status(v_match);
  perform t.ok(st ->> 'closed' = 'true' and jsonb_array_length(st -> 'tally') = 2, 'po uzavretí je výsledok verejný');
  perform t.ok((select count(*) from public.notifications where type = 'mvp_result') = 1, 'upozornenie na výsledok hlasovania');
  perform t.ok((select mvps from public.player_stats() where player_id = t.uid('p_jano')) = 1, 'MVP sa prejaví v štatistikách');
  perform public.tick();
  perform t.ok((select count(*) from public.notifications where type = 'mvp_result') = 1, 'opakovaný tick nevytvára duplicity');

  perform t.login('rejected');
  perform t.throws(format('select public.mvp_status(%L)', v_match), 'not_member', 'ne-člen nevidí stav hlasovania');
  perform t.throws('select public.tick()', 'not_member', 'ne-člen nespustí tick');
end $$;

-- ═════════ 9. Pokladnica ═════════
do $$
declare s jsonb;
begin
  perform t.login('admin');
  insert into public.treasury_entries (group_id, player_id, type, amount, note, created_by) values
    (t.uid('g1'), t.uid('p_jano'), 'fine', 10, 'Neskorý príchod', t.uid('p_admin')),
    (t.uid('g1'), t.uid('p_jano'), 'payment', 4, null, t.uid('p_admin')),
    (t.uid('g1'), t.uid('p_fero'), 'contribution', 5, 'Hala', t.uid('p_admin')),
    (t.uid('g1'), null, 'expense', 3, 'Lopta', t.uid('p_admin')),
    (t.uid('g1'), null, 'income', 5, 'Sponzor', t.uid('p_admin'));
  perform t.throws(format('insert into public.treasury_entries (group_id, type, amount, created_by) values (%L, ''income'', 1, %L)', t.get('g1'), t.get('p_jano')),
    'row-level security', 'admin sa nemôže podpísať za iného');
  perform t.throws(format('insert into public.treasury_entries (group_id, type, amount, created_by) values (%L, ''fine'', 1, %L)', t.get('g1'), t.get('p_admin')),
    'check constraint', 'pokuta musí mať hráča');
  s := public.treasury_summary();
  perform t.ok((s ->> 'cash')::numeric = 6, 'hotovosť = platby 4 + príjem 5 − výdavok 3 (pokuta ju nezvyšuje)');
  perform t.ok((s ->> 'outstanding')::numeric = 11, 'dlhy spolu = 6 + 5');
  perform t.ok((select count(*) from public.player_balances()) = 3, 'admin vidí zostatky všetkých');

  perform t.login('jano');
  s := public.treasury_summary();
  perform t.ok((s ->> 'my_debt')::numeric = 6 and (s ->> 'cash')::numeric = 6, 'hráč vidí svoj dlh 6 a celkovú hotovosť');
  perform t.ok((select count(*) from public.treasury_entries) = 4, 'hráč vidí svoje 2 položky + 2 spoločné, nie cudzie');
  perform t.ok((select count(*) from public.player_balances()) = 1, 'hráč vidí iba svoj zostatok');
  perform t.ok(t.affected('delete from public.treasury_entries') = 0, 'hráč nezmaže transakcie');
  perform t.ok((select count(*) from public.notifications where type in ('fine', 'payment')) = 2, 'upozornenia na pokutu a platbu');
  perform t.ok((select count(*) from public.notifications) = (select count(*) from public.notifications where player_id = t.uid('p_jano')), 'hráč vidí iba svoje upozornenia');
  perform public.mark_notifications_read();
  perform t.ok((public.whoami() ->> 'unread')::int = 0, 'označenie ako prečítané');
end $$;

-- ═════════ 10. Izolácia medzi partiami ═════════
do $$
begin
  perform t.login('other');
  perform t.ok((select count(*) from public.players) = 1, 'admin cudzej partie vidí iba svojich hráčov');
  perform t.ok((select count(*) from public.matches) = 0, 'nevidí cudzie zápasy');
  perform t.ok((select count(*) from public.treasury_entries) = 0, 'nevidí cudziu pokladnicu');
  perform t.ok((select count(*) from public.attendance) = 0 and (select count(*) from public.match_goals) = 0, 'nevidí cudziu dochádzku ani góly');
  perform t.ok(t.affected('update public.players set skill = 1 where nickname = ''Jano''') = 0, 'neupraví cudzích hráčov');
  perform t.ok(t.affected('delete from public.matches') = 0, 'nezmaže cudzie zápasy');
  perform t.throws(format('select public.admin_set_attendance(%L, %L, ''no'')', t.get('m1'), t.get('p_jano')), 'not_found', 'nemení cudziu dochádzku');
  perform t.throws(format('select public.save_match_result(%L, ''{"score_a":0,"score_b":0}'')', t.get('m1')), 'not_found', 'neprepíše cudzí výsledok');
  perform t.throws(format('select public.create_invite_link(''recovery'', %L)', t.get('p_jano')), 'not_found', 'nevytvorí link na cudzieho hráča');
  perform t.throws(format('insert into public.treasury_entries (group_id, type, amount, created_by) values (%L, ''income'', 1, (select id from public.players limit 1))', t.get('g1')),
    'row-level security', 'nezapíše do cudzej pokladnice');
  perform t.throws(format('insert into public.matches (group_id, season_id, starts_at) select group_id, %L, now() from public.players limit 1', t.get('s1')),
    'season_mismatch', 'termín sa nedá zavesiť na sezónu cudzej partie');
end $$;

-- ═════════ 11. Správa adminov, blokovanie, rotácia a obnova ═════════
do $$
declare v_old text := t.get('token'); v_new text; v_rec text; r jsonb;
begin
  perform t.login('admin');
  perform t.throws(format('update public.players set role = ''player'' where id = %L', t.get('p_admin')), 'last_admin', 'posledný admin sa nedá odobrať');
  update public.players set role = 'admin' where id = t.uid('p_fero');
  perform t.login('fero');
  perform t.ok(private.is_admin(), 'povýšený hráč je admin');
  update public.players set role = 'player' where id = t.uid('p_admin');
  perform t.login('admin');
  perform t.ok(not private.is_admin(), 'degradovaný admin stratil oprávnenia okamžite');
  perform t.ok(t.affected('update public.players set role = ''admin''') = 0, 'a nevie si ich vrátiť');

  -- Zablokovanie hráča
  perform t.login('fero');
  update public.players set is_active = false where id = t.uid('p_jano');
  perform t.login('jano');
  perform t.ok(public.whoami() ->> 'state' = 'blocked', 'deaktivovaný hráč je zablokovaný');
  perform t.ok((select count(*) from public.players) = 0 and (select count(*) from public.matches) = 0, 'a nevidí žiadne údaje');
  perform t.login('stranger');
  perform t.ok(public.whoami() ->> 'state' = 'blocked', 'blokovanie platí pre všetky jeho zariadenia');
  perform t.login('fero');
  update public.players set is_active = true where id = t.uid('p_jano');

  -- Odpojenie zariadenia
  delete from public.player_devices where auth_user_id = t.uid('stranger');
  perform t.login('stranger');
  perform t.ok(public.whoami() ->> 'state' = 'guest', 'odpojené zariadenie stratilo prístup');

  -- Rotácia linku
  perform t.login('fero');
  v_new := public.create_invite_link();
  perform t.login('newphone');
  r := public.join_group(v_old, 'Nový', null);
  perform t.ok(r ->> 'code' = 'invalid_link', 'po rotácii starý link neplatí');

  -- Link na obnovu prístupu (jednorazový)
  perform t.login('fero');
  v_rec := public.create_invite_link('recovery', t.uid('p_jano'));
  perform t.anon();
  perform t.ok(public.peek_invite(v_rec) ->> 'nickname' = 'Jano', 'link na obnovu ukáže, komu patrí');
  perform t.login('newphone');
  r := public.join_group(v_rec, null, 'Nový mobil');
  perform t.ok(r ->> 'status' = 'joined' and (public.whoami() -> 'player' ->> 'id') = t.get('p_jano'), 'obnova prístupu na novom zariadení');
  perform t.login('stranger');
  r := public.join_group(v_rec, null, null);
  perform t.ok(r ->> 'code' = 'invalid_link', 'link na obnovu je jednorazový');

  -- Zablokovanie pozvánky
  perform t.login('fero');
  perform public.revoke_invite_link((select id from public.invite_links where kind = 'group' and revoked_at is null));
  perform t.login('stranger');
  r := public.join_group(v_new, 'Ďalší', null);
  perform t.ok(r ->> 'code' = 'invalid_link', 'zablokovaná pozvánka neplatí');
end $$;

-- ═════════ 12. Limit hráčov, pripomienky, e-mail ═════════
do $$
declare v_token text; r jsonb; v_match uuid;
begin
  perform t.login('fero');
  update public.groups set max_players = 3;
  v_token := public.create_invite_link();
  perform t.login('stranger');
  r := public.join_group(v_token, 'Štvrtý', null);
  perform t.ok(r ->> 'code' = 'group_full', 'limit počtu hráčov platí');

  -- Pripomienky
  perform t.login('fero');
  insert into public.matches (group_id, season_id, starts_at, created_by)
    select group_id, id, now() + interval '2 hours', t.uid('p_fero') from public.seasons returning id into v_match;
  perform public.admin_set_attendance(v_match, t.uid('p_admin'), 'yes');
  perform public.tick();
  perform public.tick();
  perform t.login('jano');
  perform t.ok((select count(*) from public.notifications where type = 'rsvp_reminder') = 1, 'pripomienka nepotvrdenej dochádzky (raz)');
  perform t.login('admin');
  perform t.ok((select count(*) from public.notifications where type = 'match_reminder') = 1, 'pripomienka pred zápasom pre prihláseného');
  perform t.ok((select count(*) from public.notifications where type = 'rsvp_reminder') = 0, 'potvrdený hráč pripomienku dochádzky nedostane');

  -- E-mail je voliteľný a súkromný
  insert into public.player_contacts (player_id, email) values (t.uid('p_admin'), 'boss@example.com');
  insert into public.player_contacts (player_id, email, email_enabled) values (t.uid('p_admin'), 'boss2@example.com', false)
    on conflict (player_id) do update set player_id = excluded.player_id, email = excluded.email, email_enabled = excluded.email_enabled;
  perform t.ok((select email from public.player_contacts) = 'boss2@example.com', 'vlastný e-mail sa dá zmeniť (upsert)');
  perform t.throws(format('insert into public.player_contacts (player_id, email) values (%L, ''x@example.com'')', t.get('p_jano')), 'row-level security', 'cudzí e-mail sa nedá nastaviť');
  perform t.login('fero');
  perform t.ok((select count(*) from public.player_contacts) = 0, 'ani admin nevidí cudzie e-maily');

  -- Avatar
  perform t.login('jano');
  perform t.throws(format('select public.set_avatar(%L, null)', t.get('p_fero')), 'forbidden', 'hráč nemení cudzí avatar');
  perform t.throws(format('select public.set_avatar(%L, ''../../etc/passwd'')', t.get('p_jano')), 'invalid_path', 'cesta avatara je validovaná');
  perform public.set_avatar(t.uid('p_jano'), t.get('g1') || '/' || t.get('p_jano') || '-abcdef123456.jpg');
  perform t.ok(private.can_write_avatar(t.get('g1') || '/' || t.get('p_jano') || '-x.jpg'), 'storage: vlastný avatar povolený');
  perform t.ok(not private.can_write_avatar(t.get('g1') || '/' || t.get('p_fero') || '-x.jpg'), 'storage: cudzí avatar zakázaný');
  perform t.ok(not private.can_write_avatar(t.get('g2') || '/' || t.get('p_jano') || '-x.jpg'), 'storage: cudzia partia zakázaná');
end $$;

-- ═════════ 13. Zmazanie hráča ═════════
do $$
declare r jsonb; v_new uuid; v_goals int;
begin
  -- V tomto bode je adminom Fero; pôvodný admin (p_admin) je bežný hráč.
  perform t.login('admin');
  perform t.throws(format('select public.delete_player(%L)', t.get('p_jano')), 'forbidden', 'bežný hráč nemaže hráčov');

  perform t.login('fero');
  perform t.throws(format('select public.delete_player(%L)', t.get('p_fero')), 'cannot_delete_self', 'admin nezmaže sám seba');

  -- Hráč bez histórie → úplné zmazanie
  update public.groups set max_players = 30;
  insert into public.players (group_id, nickname) values (t.uid('g1'), 'Nováčik') returning id into v_new;
  r := public.delete_player(v_new);
  perform t.ok(r ->> 'mode' = 'deleted', 'hráč bez histórie sa zmaže úplne');
  perform t.ok(not exists (select 1 from public.players where id = v_new), 'riadok hráča zmizol');

  -- Hráč s históriou → anonymizácia
  select goals into v_goals from public.player_stats() where player_id = t.uid('p_jano');
  r := public.delete_player(t.uid('p_jano'));
  perform t.ok(r ->> 'mode' = 'anonymized', 'hráč s históriou sa anonymizuje');
  perform t.ok((select nickname like 'Bývalý hráč %' and not is_active and deleted_at is not null and avatar_path is null
                from public.players where id = t.uid('p_jano')), 'prezývka, fotka a aktivita sú anonymizované');
  perform t.ok((select goals from public.player_stats() where player_id = t.uid('p_jano')) = v_goals, 'góly v histórii ostali');
  perform t.ok(not exists (select 1 from public.player_devices where player_id = t.uid('p_jano')), 'zariadenia sú odpojené');
  perform t.throws(format('select public.delete_player(%L)', t.get('p_jano')), 'not_found', 'zmazaný hráč sa nedá zmazať druhýkrát');

  perform t.login('newphone');
  perform t.ok(public.whoami() ->> 'state' = 'guest', 'zariadenie zmazaného hráča stratilo prístup');
  perform t.ok((select count(*) from public.players) = 0, 'a nevidí žiadne údaje');

  -- Prezývka je znova voľná
  perform t.login('fero');
  insert into public.players (group_id, nickname) values (t.uid('g1'), 'Jano');
  perform t.ok(true, 'prezývka zmazaného hráča sa dá použiť znova');

  -- Cudzia partia
  perform t.login('other');
  perform t.throws(format('select public.delete_player(%L)', t.get('p_fero')), 'not_found', 'admin cudzej partie nezmaže hráča');
  perform t.anon();
  perform t.throws(format('select public.delete_player(%L)', t.get('p_fero')), 'permission denied', 'anon nemá prístup');
end $$;

do $$
begin
  perform t.root();
  raise notice 'RLS testy: všetkých % kontrol prešlo.', current_setting('t.count');
end $$;

rollback;
