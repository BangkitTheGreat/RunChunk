-- RunChunk initial schema: profiles, workflows, executions, execution_logs.
-- Browser clients (anon/authenticated) are limited by RLS + column grants.
-- Executions/logs are written only by the server (service_role, bypasses RLS).

-- updated_at helper --------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- profiles -----------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  locale text not null default 'id' check (locale in ('id', 'en')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- workflows ----------------------------------------------------------------
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  definition jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- target of executions composite FK: execution owner must equal workflow owner
  unique (id, user_id)
);

create index workflows_user_updated_idx on public.workflows (user_id, updated_at desc);

create or replace function public.update_workflow_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function public.update_workflow_version();

-- executions ---------------------------------------------------------------
create table public.executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  definition_snapshot jsonb not null,
  definition_version int not null,
  trigger_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'running', 'success', 'failed', 'skipped', 'partial_failed', 'dispatch_failed'
  )),
  error text,
  output jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workflow_id, user_id) references public.workflows (id, user_id) on delete cascade
);

create index executions_user_created_idx on public.executions (user_id, created_at desc);
create index executions_workflow_created_idx on public.executions (workflow_id, created_at desc);

-- execution_logs -----------------------------------------------------------
create table public.execution_logs (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.executions (id) on delete cascade,
  node_id text not null check (char_length(node_id) <= 100),
  status text not null check (status in ('pending', 'running', 'success', 'failed', 'skipped')),
  summary text check (char_length(summary) <= 2000),
  output jsonb,
  duration_ms int not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_id, node_id)
);

create index execution_logs_execution_created_idx on public.execution_logs (execution_id, created_at);

create trigger execution_logs_set_updated_at
  before update on public.execution_logs
  for each row execute function public.set_updated_at();

-- privileges ---------------------------------------------------------------
-- Supabase grants ALL on public tables to anon/authenticated by default; narrow it.
revoke all on public.profiles, public.workflows, public.executions, public.execution_logs
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (locale) on public.profiles to authenticated;
grant select, delete on public.workflows to authenticated;
grant insert (user_id, name, definition) on public.workflows to authenticated;
grant update (name, definition) on public.workflows to authenticated;
grant select on public.executions, public.execution_logs to authenticated;

-- RLS ----------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workflows enable row level security;
alter table public.executions enable row level security;
alter table public.execution_logs enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workflows_select_own on public.workflows
  for select to authenticated using (user_id = (select auth.uid()));
create policy workflows_insert_own on public.workflows
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy workflows_update_own on public.workflows
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy workflows_delete_own on public.workflows
  for delete to authenticated using (user_id = (select auth.uid()));

create policy executions_select_own on public.executions
  for select to authenticated using (user_id = (select auth.uid()));

create policy execution_logs_select_own on public.execution_logs
  for select to authenticated using (
    exists (
      select 1 from public.executions e
      where e.id = execution_logs.execution_id and e.user_id = (select auth.uid())
    )
  );

-- Realtime (owner-filtered by RLS) ----------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.executions, public.execution_logs;
  end if;
end;
$$;
