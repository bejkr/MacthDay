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
