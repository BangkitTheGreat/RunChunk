-- Week 5-6 database checks: atomic quota, activation limit, webhook rate limit, schedule claim (CAS),
-- last-execution view, and RLS on the new tables. Run after migrations (see README); everything rolls back.
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/quota_webhook_schedule.sql
begin;

-- Fixtures (superuser) ---------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'q-a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'q-b@test.local', 'authenticated', 'authenticated');

insert into public.workflows (id, user_id, name, definition) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'w1', '{}'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'w2', '{}'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'w3', '{}'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 'w4', '{}');

insert into public.executions (id, workflow_id, user_id, definition_snapshot, definition_version, status, trigger_source, created_at) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '{}', 1, 'failed', 'manual', now() - interval '2 hours'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '{}', 1, 'success', 'webhook', now() - interval '1 hour');

-- Service role: activation limit, quota, rate limit, schedules -------------------
set local role service_role;

do $$
declare
  r record;
  i int;
  ep uuid;
  sid uuid;
  slot timestamptz := date_trunc('minute', now()) - interval '1 minute';
begin
  -- activation: free plan allows 3 active workflows, atomically
  for i in 1..3 loop
    select * into r from public.set_workflow_active(('10000000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-00000000000a', true);
    if not r.ok then raise exception 'FAIL: activation % refused', i; end if;
  end loop;
  select * into r from public.set_workflow_active('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', true);
  if r.ok or r.active_limit <> 3 or r.active_count <> 3 then raise exception 'FAIL: 4th activation should be refused (ok=%, count=%, limit=%)', r.ok, r.active_count, r.active_limit; end if;
  select * into r from public.set_workflow_active('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', false);
  select * into r from public.set_workflow_active('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', true);
  if not r.ok then raise exception 'FAIL: activation after deactivation refused'; end if;
  -- another user's workflow cannot be activated through the RPC
  select * into r from public.set_workflow_active('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', true);
  if r.ok then raise exception 'FAIL: activated workflow of another owner'; end if;

  -- quota: 100 runs/month on free, the 101st is refused, release gives one back
  for i in 1..100 loop
    select * into r from public.reserve_run('00000000-0000-0000-0000-00000000000a');
    if not r.allowed or r.used <> i then raise exception 'FAIL: reservation % refused (used=%)', i, r.used; end if;
  end loop;
  select * into r from public.reserve_run('00000000-0000-0000-0000-00000000000a');
  if r.allowed or r.used <> 100 or r.quota <> 100 then raise exception 'FAIL: 101st run allowed (used=%, quota=%)', r.used, r.quota; end if;
  perform public.release_run('00000000-0000-0000-0000-00000000000a', r.period_start);
  select * into r from public.reserve_run('00000000-0000-0000-0000-00000000000a');
  if not r.allowed or r.used <> 100 then raise exception 'FAIL: reservation after release refused'; end if;
  select * into r from public.reserve_run('00000000-0000-0000-0000-000000000099'); -- no profile
  if r.allowed then raise exception 'FAIL: unknown user reserved a run'; end if;

  -- webhook rate limit: 10 hits per window on free, the 11th waits
  insert into public.webhook_endpoints (workflow_id, user_id, token_hash, token_hint)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', repeat('ab', 32), 'wxyz')
    returning id into ep;
  for i in 1..10 loop
    select * into r from public.webhook_hit(ep, 10, 60);
    if not r.allowed then raise exception 'FAIL: webhook hit % refused', i; end if;
  end loop;
  select * into r from public.webhook_hit(ep, 10, 60);
  if r.allowed or r.retry_after < 1 or r.retry_after > 60 then raise exception 'FAIL: 11th hit allowed or bad retry_after (%)', r.retry_after; end if;
  perform public.prune_rate_limits();

  -- signing columns are all-or-none, and service_role can set/clear them
  update public.webhook_endpoints set signing_ciphertext = 'c', signing_nonce = 'n', signing_tag = 't', signing_key_version = 1, signing_hint = 'ab12', signing_created_at = now() where id = ep;
  begin
    update public.webhook_endpoints set signing_hint = null where id = ep;
    raise exception 'FAIL: partial signing columns accepted';
  exception when check_violation then null;
  end;

  -- schedules: due only while the workflow is active; claim is compare-and-swap
  insert into public.workflow_schedules (workflow_id, user_id, cron, timezone, next_run_at)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '*/1 * * * *', 'Asia/Jakarta', slot)
    returning id into sid;
  insert into public.workflow_schedules (workflow_id, user_id, cron, timezone, next_run_at)
    values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '*/1 * * * *', 'Asia/Jakarta', slot); -- inactive workflow
  if (select count(*) from public.due_schedules(now(), 50)) <> 1 then raise exception 'FAIL: due_schedules should list only the active workflow'; end if;
  if not public.claim_schedule(sid, slot, slot + interval '10 minutes') then raise exception 'FAIL: first claim refused'; end if;
  if public.claim_schedule(sid, slot, slot + interval '10 minutes') then raise exception 'FAIL: second claim of the same slot succeeded (duplicate dispatch)'; end if;
  if (select count(*) from public.due_schedules(now(), 50)) <> 0 then raise exception 'FAIL: claimed schedule still due'; end if;
  if (select last_run_at from public.workflow_schedules where id = sid) <> slot then raise exception 'FAIL: last_run_at not recorded'; end if;
end;
$$;

-- As user A: read own usage/metadata, never secrets, never spend quota --------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$
declare
  r record;
  n int;
begin
  select * into r from public.my_usage();
  if r.plan <> 'free' or r.runs <> 100 or r.quota <> 100 or r.active_workflows <> 3 or r.active_limit <> 3 or r.webhook_per_minute <> 10 then
    raise exception 'FAIL: my_usage wrong (plan=%, runs=%, quota=%, active=%/%)', r.plan, r.runs, r.quota, r.active_workflows, r.active_limit;
  end if;
  if (select count(*) from public.usage_counters) <> 1 then raise exception 'FAIL: A cannot see own usage row'; end if;
  if (select count(*) from (select id, token_hint, last_received_at, signing_hint, signing_created_at from public.webhook_endpoints) e) <> 1 then raise exception 'FAIL: A cannot see own webhook metadata'; end if;
  begin
    perform token_hash from public.webhook_endpoints;
    raise exception 'FAIL: A read webhook token hash';
  exception when insufficient_privilege then null;
  end;
  -- each secret column on its own: one leaked column must fail the suite
  begin
    perform signing_ciphertext from public.webhook_endpoints;
    raise exception 'FAIL: A read webhook signing ciphertext';
  exception when insufficient_privilege then null;
  end;
  begin
    perform signing_nonce from public.webhook_endpoints;
    raise exception 'FAIL: A read webhook signing nonce';
  exception when insufficient_privilege then null;
  end;
  begin
    perform signing_tag from public.webhook_endpoints;
    raise exception 'FAIL: A read webhook signing tag';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.workflow_schedules) <> 2 then raise exception 'FAIL: A cannot see own schedules'; end if;
  select status, trigger_source into r from public.workflow_last_executions where workflow_id = '10000000-0000-0000-0000-000000000001';
  if r.status <> 'success' or r.trigger_source <> 'webhook' then raise exception 'FAIL: last execution view wrong (%, %)', r.status, r.trigger_source; end if;

  update public.workflows set route_color = 4 where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A cannot pick route color'; end if;
  begin
    update public.workflows set is_active = false where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: A toggled is_active directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.workflows set route_color = 7 where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: route color outside 1..6 accepted';
  exception when check_violation then null;
  end;

  -- quota, rate limit, activation and claims are server-only
  begin perform public.reserve_run('00000000-0000-0000-0000-00000000000a'); raise exception 'FAIL: client reserved a run';
  exception when insufficient_privilege then null; end;
  begin perform public.release_run('00000000-0000-0000-0000-00000000000a', current_date); raise exception 'FAIL: client released a run';
  exception when insufficient_privilege then null; end;
  begin perform public.set_workflow_active('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', true); raise exception 'FAIL: client activated a workflow';
  exception when insufficient_privilege then null; end;
  begin perform public.webhook_hit(gen_random_uuid(), 10, 60); raise exception 'FAIL: client counted a webhook hit';
  exception when insufficient_privilege then null; end;
  begin perform public.claim_schedule(gen_random_uuid(), now(), now()); raise exception 'FAIL: client claimed a schedule';
  exception when insufficient_privilege then null; end;
  begin perform public.due_schedules(now(), 1); raise exception 'FAIL: client listed due schedules';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.webhook_endpoints (workflow_id, user_id, token_hash, token_hint)
      values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', repeat('cd', 32), 'abcd');
    raise exception 'FAIL: client inserted webhook endpoint';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workflow_schedules (workflow_id, user_id, cron, timezone, next_run_at)
      values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '* * * * *', 'UTC', now());
    raise exception 'FAIL: client inserted schedule';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.usage_counters set runs = 0;
    raise exception 'FAIL: client reset usage';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- As user B: nothing of A is visible ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

do $$
declare r record;
begin
  if exists (select id from public.webhook_endpoints) then raise exception 'FAIL: B sees A webhook endpoint'; end if;
  if exists (select 1 from public.workflow_schedules) then raise exception 'FAIL: B sees A schedule'; end if;
  if exists (select 1 from public.usage_counters) then raise exception 'FAIL: B sees A usage'; end if;
  if exists (select 1 from public.workflow_last_executions) then raise exception 'FAIL: B sees A last executions'; end if;
  select * into r from public.my_usage();
  if r.runs <> 0 or r.active_workflows <> 0 then raise exception 'FAIL: B usage not isolated'; end if;
end;
$$;

reset role;

-- Pro (simulated, set by admin in the DB) raises the limits ------------------------
update public.profiles set plan = 'pro' where id = '00000000-0000-0000-0000-00000000000b';
set local role service_role;
do $$
declare r record;
begin
  select * into r from public.reserve_run('00000000-0000-0000-0000-00000000000b');
  if not r.allowed or r.quota <> 5000 then raise exception 'FAIL: pro quota wrong (%)', r.quota; end if;
end;
$$;
reset role;

do $$ begin raise notice 'quota_webhook_schedule: all checks passed'; end; $$;

rollback;
