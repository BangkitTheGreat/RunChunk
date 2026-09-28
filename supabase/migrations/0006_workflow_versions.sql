-- Workflow versioning (stretch): every saved definition is kept so a bad save can be rolled back.
-- Recording happens in a trigger on workflows, so the API stays unchanged and a restore is itself a
-- new version (nothing is ever overwritten). Retention: newest 20 versions per workflow.

create table public.workflow_versions (
  id bigint generated always as identity primary key,
  workflow_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  version int not null,
  name text not null,
  definition jsonb not null,
  route_color smallint not null default 1,
  created_at timestamptz not null default now(),
  unique (workflow_id, version),
  foreign key (workflow_id, user_id) references public.workflows (id, user_id) on delete cascade
);

create index workflow_versions_workflow_idx on public.workflow_versions (workflow_id, version desc);

revoke all on public.workflow_versions from anon, authenticated;
grant select on public.workflow_versions to authenticated;
grant select, insert, delete on public.workflow_versions to service_role;

alter table public.workflow_versions enable row level security;
create policy workflow_versions_select_own on public.workflow_versions
  for select to authenticated using (user_id = (select auth.uid()));

-- Lightweight listing: counts instead of the full definition.
create view public.workflow_version_summaries
with (security_invoker = true) as
  select id, workflow_id, user_id, version, name, route_color, created_at,
    jsonb_array_length(coalesce(definition -> 'nodes', '[]'::jsonb)) as node_count,
    jsonb_array_length(coalesce(definition -> 'edges', '[]'::jsonb)) as edge_count
  from public.workflow_versions;

grant select on public.workflow_version_summaries to authenticated;

-- Record a version on insert and whenever the definition or name changes. Activation toggles and
-- color changes bump workflows.version too but are not worth a snapshot.
create or replace function public.record_workflow_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.definition is not distinct from old.definition and new.name is not distinct from old.name then
    return new;
  end if;
  insert into public.workflow_versions (workflow_id, user_id, version, name, definition, route_color)
    values (new.id, new.user_id, new.version, new.name, new.definition, new.route_color)
  on conflict (workflow_id, version) do nothing;
  delete from public.workflow_versions v
    where v.workflow_id = new.id
      and v.version not in (
        select version from public.workflow_versions where workflow_id = new.id order by version desc limit 20
      );
  return new;
end;
$$;

revoke all on function public.record_workflow_version() from public, anon, authenticated;

create trigger workflows_record_version
  after insert or update on public.workflows
  for each row execute function public.record_workflow_version();
