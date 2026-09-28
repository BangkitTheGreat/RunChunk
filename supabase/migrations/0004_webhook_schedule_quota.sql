-- Week 5-6: activation + Jalur color, webhook endpoints, schedules, atomic quota, DB-backed rate limit.
-- Every function here that spends quota or mutates state is service_role-only; browsers get read access
-- to their own rows through RLS and a single read-only usage function.

-- plan limits ----------------------------------------------------------------
-- Pro is a simulation: the plan is set by an admin in the database (profiles.plan), never by the client.
create or replace function public.plan_limits(p_plan text)
returns table (runs_per_month int, active_workflows int, webhook_per_minute int)
language sql
immutable
set search_path = ''
as $$
  select case when p_plan = 'pro' then 5000 else 100 end,
         case when p_plan = 'pro' then 10 else 3 end,
         case when p_plan = 'pro' then 60 else 10 end;
$$;

-- workflows: activation switch + route color ----------------------------------
alter table public.workflows
  add column is_active boolean not null default false,
  add column route_color smallint not null default 1 check (route_color between 1 and 6);

-- Clients may pick a color; activation goes through set_workflow_active (limit check) only.
grant insert (route_color) on public.workflows to authenticated;
grant update (route_color) on public.workflows to authenticated;

-- executions: where the run came from ---------------------------------------
alter table public.executions
  add column trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'webhook', 'schedule'));

-- Latest execution per workflow, for the dashboard. security_invoker keeps RLS of executions in force.
create view public.workflow_last_executions
with (security_invoker = true) as
  select distinct on (workflow_id)
    workflow_id, user_id, id as execution_id, status, trigger_source, created_at, finished_at
  from public.executions
  order by workflow_id, created_at desc;

grant select on public.workflow_last_executions to authenticated;

-- webhook_endpoints ----------------------------------------------------------
-- One public URL per workflow. Only the SHA-256 of the token is stored; the token itself is shown once.
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (char_length(token_hint) = 4),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_received_at timestamptz,
  foreign key (workflow_id, user_id) references public.workflows (id, user_id) on delete cascade
);

revoke all on public.webhook_endpoints from anon, authenticated;
grant select (id, workflow_id, user_id, token_hint, created_at, rotated_at, last_received_at) on public.webhook_endpoints to authenticated;
grant select, insert, update, delete on public.webhook_endpoints to service_role;

alter table public.webhook_endpoints enable row level security;
create policy webhook_endpoints_select_own on public.webhook_endpoints
  for select to authenticated using (user_id = (select auth.uid()));

-- webhook rate limit (fixed window, stored so every instance shares it) ------
create table public.webhook_rate_limits (
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (endpoint_id, window_start)
);

revoke all on public.webhook_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.webhook_rate_limits to service_role;
alter table public.webhook_rate_limits enable row level security;

-- Counts one hit in the current window; the ON CONFLICT row lock makes concurrent hits serialize.
create or replace function public.webhook_hit(p_endpoint_id uuid, p_limit int, p_window_seconds int)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  if p_limit < 1 then
    return query select false, p_window_seconds;
    return;
  end if;
  insert into public.webhook_rate_limits (endpoint_id, window_start, hits)
    values (p_endpoint_id, v_window, 1)
  on conflict (endpoint_id, window_start) do update
    set hits = public.webhook_rate_limits.hits + 1
    where public.webhook_rate_limits.hits < p_limit
  returning hits into v_hits;
  return query select v_hits is not null,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::int);
end;
$$;

create or replace function public.prune_rate_limits()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.webhook_rate_limits where window_start < now() - interval '1 hour';
$$;

-- workflow_schedules ---------------------------------------------------------
-- Mirror of the trigger.schedule node, kept by the server on save/activate. Fires only while the
-- workflow is active. next_run_at is the claim token: the dispatcher advances it with compare-and-swap.
create table public.workflow_schedules (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  cron text not null check (char_length(cron) between 9 and 100),
  timezone text not null check (char_length(timezone) between 1 and 64),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workflow_id, user_id) references public.workflows (id, user_id) on delete cascade
);

create index workflow_schedules_due_idx on public.workflow_schedules (next_run_at);

create trigger workflow_schedules_set_updated_at
  before update on public.workflow_schedules
  for each row execute function public.set_updated_at();

revoke all on public.workflow_schedules from anon, authenticated;
grant select on public.workflow_schedules to authenticated;
grant select, insert, update, delete on public.workflow_schedules to service_role;

alter table public.workflow_schedules enable row level security;
create policy workflow_schedules_select_own on public.workflow_schedules
  for select to authenticated using (user_id = (select auth.uid()));

-- Due rows of active workflows. The dispatcher computes the next slot in JS and claims with claim_schedule.
create or replace function public.due_schedules(p_now timestamptz, p_limit int)
returns table (id uuid, workflow_id uuid, user_id uuid, cron text, timezone text, next_run_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.workflow_id, s.user_id, s.cron, s.timezone, s.next_run_at
  from public.workflow_schedules s
  join public.workflows w on w.id = s.workflow_id and w.user_id = s.user_id
  where w.is_active and s.next_run_at <= p_now
  order by s.next_run_at
  limit p_limit;
$$;

-- Compare-and-swap: succeeds for exactly one caller per slot, so concurrent dispatchers never double-fire.
create or replace function public.claim_schedule(p_id uuid, p_expected timestamptz, p_next timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.workflow_schedules
    set next_run_at = p_next, last_run_at = p_expected
    where id = p_id and next_run_at = p_expected;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- usage_counters + atomic quota ---------------------------------------------
create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  runs int not null default 0 check (runs >= 0),
  primary key (user_id, period_start)
);

revoke all on public.usage_counters from anon, authenticated;
grant select on public.usage_counters to authenticated;
grant select, insert, update, delete on public.usage_counters to service_role;

alter table public.usage_counters enable row level security;
create policy usage_counters_select_own on public.usage_counters
  for select to authenticated using (user_id = (select auth.uid()));

-- Reserves one run for the current UTC month. The ON CONFLICT ... WHERE runs < quota update takes the
-- row lock, so parallel requests serialize and the (quota+1)th is refused. Same path for manual,
-- webhook and schedule.
create or replace function public.reserve_run(p_user_id uuid)
returns table (allowed boolean, used int, quota int, period_start date)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_period date := (date_trunc('month', now() at time zone 'utc'))::date;
  v_quota int;
  v_runs int;
begin
  select l.runs_per_month into v_quota
    from public.profiles p cross join public.plan_limits(p.plan) l
    where p.id = p_user_id;
  if v_quota is null or v_quota < 1 then
    return query select false, 0, coalesce(v_quota, 0), v_period;
    return;
  end if;
  insert into public.usage_counters (user_id, period_start, runs)
    values (p_user_id, v_period, 1)
  on conflict (user_id, period_start) do update
    set runs = public.usage_counters.runs + 1
    where public.usage_counters.runs < v_quota
  returning runs into v_runs;
  if v_runs is null then
    select u.runs into v_runs from public.usage_counters u where u.user_id = p_user_id and u.period_start = v_period;
    return query select false, coalesce(v_runs, 0), v_quota, v_period;
  else
    return query select true, v_runs, v_quota, v_period;
  end if;
end;
$$;

-- Gives a reservation back when the run could not be dispatched.
create or replace function public.release_run(p_user_id uuid, p_period_start date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_counters set runs = greatest(runs - 1, 0)
    where user_id = p_user_id and period_start = p_period_start;
$$;

-- Activation under a per-user advisory lock so two concurrent activations cannot both pass the count.
create or replace function public.set_workflow_active(p_workflow_id uuid, p_user_id uuid, p_active boolean)
returns table (ok boolean, active_count int, active_limit int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
  v_updated int;
begin
  perform pg_advisory_xact_lock(hashtext('workflow_activation:' || p_user_id::text));
  select l.active_workflows into v_limit
    from public.profiles p cross join public.plan_limits(p.plan) l where p.id = p_user_id;
  select count(*) into v_count from public.workflows
    where user_id = p_user_id and is_active and id <> p_workflow_id;
  if p_active and v_count >= coalesce(v_limit, 0) then
    return query select false, v_count, coalesce(v_limit, 0);
    return;
  end if;
  update public.workflows set is_active = p_active where id = p_workflow_id and user_id = p_user_id;
  get diagnostics v_updated = row_count;
  return query select v_updated = 1, v_count + (case when p_active then 1 else 0 end), coalesce(v_limit, 0);
end;
$$;

-- Read-only usage summary for the signed-in user (security invoker: RLS applies).
create or replace function public.my_usage()
returns table (plan text, runs int, quota int, active_workflows int, active_limit int, webhook_per_minute int, period_start date)
language sql
stable
set search_path = ''
as $$
  select p.plan,
         coalesce((select u.runs from public.usage_counters u
                   where u.user_id = p.id and u.period_start = (date_trunc('month', now() at time zone 'utc'))::date), 0),
         l.runs_per_month,
         (select count(*)::int from public.workflows w where w.user_id = p.id and w.is_active),
         l.active_workflows,
         l.webhook_per_minute,
         (date_trunc('month', now() at time zone 'utc'))::date
  from public.profiles p cross join public.plan_limits(p.plan) l
  where p.id = (select auth.uid());
$$;

-- privileges on functions -----------------------------------------------------
revoke all on function public.webhook_hit(uuid, int, int), public.prune_rate_limits(),
  public.due_schedules(timestamptz, int), public.claim_schedule(uuid, timestamptz, timestamptz),
  public.reserve_run(uuid), public.release_run(uuid, date), public.set_workflow_active(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.webhook_hit(uuid, int, int), public.prune_rate_limits(),
  public.due_schedules(timestamptz, int), public.claim_schedule(uuid, timestamptz, timestamptz),
  public.reserve_run(uuid), public.release_run(uuid, date), public.set_workflow_active(uuid, uuid, boolean)
  to service_role;
grant execute on function public.plan_limits(text), public.my_usage() to authenticated;

-- Realtime: workflows changes let the dashboard follow activation/last-status without polling.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.workflows;
  end if;
end;
$$;
