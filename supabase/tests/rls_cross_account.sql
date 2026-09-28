-- Cross-account RLS checks. Run as superuser against local Supabase after migrations:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_cross_account.sql
-- Any failure raises an exception. Everything is rolled back.
begin;

-- Fixtures (superuser, bypasses RLS) ----------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'rls-a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-b@test.local', 'authenticated', 'authenticated');

insert into public.workflows (id, user_id, name, definition) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'A flow', '{}');

insert into public.executions (id, workflow_id, user_id, definition_snapshot, definition_version) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-00000000000a', '{}', 1);

insert into public.execution_logs (execution_id, node_id, status) values
  ('20000000-0000-0000-0000-00000000000a', 'trigger', 'success');

insert into public.credentials (id, user_id, name, type, header_name, ciphertext, nonce, tag, key_version) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'A key', 'api_key', 'x-api-key',
   'Y2lwaGVy', 'bm9uY2Vub25jZQ==', 'dGFndGFndGFndGFndGFn', 1);

do $$
begin
  if (select count(*) from public.profiles
      where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) <> 2 then
    raise exception 'profile trigger did not create profiles';
  end if;

  -- execution owner must match workflow owner (composite FK)
  begin
    insert into public.executions (workflow_id, user_id, definition_snapshot, definition_version)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '{}', 1);
    raise exception 'FAIL: execution with mismatched owner inserted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

-- As user A: sees own rows ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.workflows) <> 1 then raise exception 'FAIL: A cannot see own workflow'; end if;
  if (select count(*) from public.executions) <> 1 then raise exception 'FAIL: A cannot see own execution'; end if;
  if (select count(*) from public.execution_logs) <> 1 then raise exception 'FAIL: A cannot see own log'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: A profile visibility wrong'; end if;

  update public.workflows set definition = '{"v":2}' where id = '10000000-0000-0000-0000-00000000000a';
  if (select version from public.workflows where id = '10000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'FAIL: workflow version did not increment';
  end if;

  begin
    update public.workflows set version = 99 where id = '10000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: A updated workflow version directly';
  exception when insufficient_privilege then null;
  end;

  -- Vault: owner sees metadata only, never ciphertext, and cannot write secrets directly
  if (select count(*) from (select id, name, type, header_name from public.credentials) c) <> 1 then
    raise exception 'FAIL: A cannot see own credential metadata';
  end if;
  begin
    perform ciphertext from public.credentials;
    raise exception 'FAIL: A read credential ciphertext';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nonce, tag from public.credentials;
    raise exception 'FAIL: A read credential nonce/tag';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.credentials (user_id, name, type, ciphertext, nonce, tag, key_version)
    values ('00000000-0000-0000-0000-00000000000a', 'raw', 'bearer', 'x', 'x', 'x', 1);
    raise exception 'FAIL: client inserted credential';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.credentials set name = 'renamed';
    raise exception 'FAIL: client updated credential';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- As user B: cannot touch A --------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  if exists (select 1 from public.workflows) then raise exception 'FAIL: B sees A workflow'; end if;
  if exists (select 1 from public.executions) then raise exception 'FAIL: B sees A execution'; end if;
  if exists (select 1 from public.execution_logs) then raise exception 'FAIL: B sees A log'; end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: B sees A profile';
  end if;

  update public.workflows set name = 'pwned' where id = '10000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A workflow'; end if;

  delete from public.workflows where id = '10000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A workflow'; end if;

  begin
    insert into public.workflows (user_id, name, definition)
    values ('00000000-0000-0000-0000-00000000000a', 'forged', '{}');
    raise exception 'FAIL: B inserted workflow owned by A';
  exception when insufficient_privilege then null; -- RLS WITH CHECK violation
  end;

  begin
    update public.executions set status = 'success' where id = '20000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: B updated A execution';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.executions where id = '20000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: B deleted A execution';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.execution_logs set summary = 'x';
    raise exception 'FAIL: B updated logs';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.execution_logs;
    raise exception 'FAIL: B deleted logs';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.executions (workflow_id, user_id, definition_snapshot, definition_version)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '{}', 1);
    raise exception 'FAIL: client inserted execution';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.execution_logs (execution_id, node_id, status)
    values ('20000000-0000-0000-0000-00000000000a', 'forged', 'success');
    raise exception 'FAIL: client inserted log';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set plan = 'pro' where id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'FAIL: B upgraded own plan';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A locale'; end if;

  update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: B cannot update own locale'; end if;

  if exists (select id from public.credentials) then raise exception 'FAIL: B sees A credential'; end if;
  delete from public.credentials where id = '30000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A credential'; end if;

  -- B's own workflow works
  insert into public.workflows (name, definition) values ('B flow', '{}');
  if (select count(*) from public.workflows) <> 1 then raise exception 'FAIL: B own workflow insert'; end if;
end;
$$;

reset role;

do $$
begin
  if (select name from public.workflows where id = '10000000-0000-0000-0000-00000000000a') <> 'A flow' then
    raise exception 'FAIL: A workflow changed';
  end if;
  if (select version from public.workflows where id = '10000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'FAIL: A workflow version changed by B';
  end if;
  if (select status from public.executions where id = '20000000-0000-0000-0000-00000000000a') <> 'pending' then
    raise exception 'FAIL: A execution changed';
  end if;
  if not exists (select 1 from public.credentials where id = '30000000-0000-0000-0000-00000000000a' and name = 'A key') then
    raise exception 'FAIL: A credential changed';
  end if;
  raise notice 'rls_cross_account: all checks passed';
end;
$$;

rollback;
