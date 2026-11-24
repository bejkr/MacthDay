-- MATCHDAY · Zmazanie hráča
-- Hráč bez histórie (žiadne zápasy, góly, MVP ani pokladnica) sa zmaže úplne.
-- Hráč s históriou sa anonymizuje: zmiznú jeho osobné údaje, zariadenia a e-mail,
-- v starých zápasoch a pokladnici ostane ako „Bývalý hráč“, aby sedeli výsledky aj súčty.

alter table public.players add column if not exists deleted_at timestamptz;

create or replace function public.delete_player(p_player uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := private.require_admin();
  v_group  uuid := private.my_group_id();
  v_p      public.players;
  v_has_history boolean;
begin
  select * into v_p from public.players where id = p_player and group_id = v_group for update;
  if not found or v_p.deleted_at is not null then raise exception 'not_found'; end if;
  if v_p.id = v_me then raise exception 'cannot_delete_self'; end if;

  v_has_history :=
       exists (select 1 from public.match_player_stats s join public.matches m on m.id = s.match_id
               where s.player_id = p_player and m.status = 'played')
    or exists (select 1 from public.match_goals where scorer_id = p_player or assist_id = p_player)
    or exists (select 1 from public.matches where mvp_player_id = p_player)
    or exists (select 1 from public.treasury_entries where player_id = p_player or created_by = p_player);

  if not v_has_history then
    -- Zariadenia, e-mail, upozornenia, dochádzka, hlasy a žiadosti sa zmažú kaskádou.
    delete from public.players where id = p_player;
    return jsonb_build_object('mode', 'deleted', 'avatar_path', v_p.avatar_path);
  end if;

  -- Anonymizácia: najprv odobrať prístup a osobné údaje.
  delete from public.player_devices where player_id = p_player;
  delete from public.player_contacts where player_id = p_player;
  delete from public.notifications where player_id = p_player;
  delete from public.access_requests where player_id = p_player;
  delete from public.invite_links where player_id = p_player;
  -- Prihlásenia na budúce termíny a zostavy neodohraných zápasov
  delete from public.attendance a using public.matches m
    where a.match_id = m.id and a.player_id = p_player and m.status <> 'played';
  delete from public.match_player_stats s using public.matches m
    where s.match_id = m.id and s.player_id = p_player and m.status <> 'played';

  update public.players set
    nickname      = 'Bývalý hráč ' || upper(left(replace(p_player::text, '-', ''), 5)),
    role          = 'player',
    is_active     = false,
    avatar_path   = null,
    avatar_color  = '#8D9990',
    jersey_number = null,
    position      = null,
    deleted_at    = now()
  where id = p_player;

  return jsonb_build_object('mode', 'anonymized', 'avatar_path', v_p.avatar_path);
end $$;

revoke execute on function public.delete_player(uuid) from public, anon;
grant execute on function public.delete_player(uuid) to authenticated;
