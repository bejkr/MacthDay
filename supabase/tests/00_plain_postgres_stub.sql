-- Iba pre testovanie migrácií na čistom PostgreSQL (bez Supabase/Dockeru).
-- Vytvorí minimum toho, čo Supabase poskytuje: roly, auth.uid(), auth.users, storage.
-- NIKDY nespúšťať na skutočnom Supabase projekte.
-- Roly sú spoločné pre celý Postgres cluster, preto ich vytvárame iba ak chýbajú.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create schema storage;

create table auth.users (
  id           uuid primary key default gen_random_uuid(),
  is_anonymous boolean default true,
  created_at   timestamptz default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text
);
alter table storage.objects enable row level security;

grant usage on schema public to anon, authenticated, service_role;
-- Rovnaké predvolené privilégiá, aké nastavuje Supabase – migrácie ich musia vedieť odobrať.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
