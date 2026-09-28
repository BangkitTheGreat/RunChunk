-- Minimal stand-in for the Supabase pieces the migrations depend on, so migrations and
-- rls_cross_account.sql can run against a plain PostgreSQL 15+ (CI, containers without Docker).
-- Not for production. Usage (empty database):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/vanilla_postgres_stub.sql
--   for f in supabase/migrations/*.sql; do psql "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/rls_cross_account.sql

-- Roles are cluster-wide, so tolerate a second database in the same cluster.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  -- Like Supabase: service_role bypasses RLS but still needs explicit table privileges.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  aud text,
  role text
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants everything on new public tables to the API roles; migrations must narrow it.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
