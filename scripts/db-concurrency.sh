#!/usr/bin/env bash
# Parallel checks for the week 5-6 atomic RPCs. quota_webhook_schedule.sql runs them one at a time;
# this fires many separate connections at once, released together by an advisory-lock barrier.
# Needs committed rows, so it creates one throwaway user and deletes it (cascade) on exit.
# Usage: DB=... scripts/db-concurrency.sh   (run after migrations; scripts/db-check.sh calls it)
set -euo pipefail
: "${DB:?set DB}"
U=00000000-0000-0000-0000-0000000000c1
EP=30000000-0000-0000-0000-0000000000c1
SID=40000000-0000-0000-0000-0000000000c1
SLOT="2026-01-01 00:00:00+00"
LOCK=4242420
sql() { psql "$DB" -v ON_ERROR_STOP=1 -qAtX "$@"; }
out=$(mktemp -d)
trap 'sql -c "delete from auth.users where id = '"'$U'"'" >/dev/null; rm -rf "$out"' EXIT

sql <<SQL
delete from auth.users where id = '$U';
insert into auth.users (id, email, aud, role) values ('$U', 'conc@test.local', 'authenticated', 'authenticated');
insert into public.workflows (id, user_id, name, definition)
  select ('10000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, '$U', 'c' || i, '{}'
  from generate_series(1, 10) i;
insert into public.webhook_endpoints (id, workflow_id, user_id, token_hash, token_hint)
  values ('$EP', '10000000-0000-0000-0000-000000000001', '$U', repeat('ef', 32), 'conc');
insert into public.workflow_schedules (id, workflow_id, user_id, cron, timezone, next_run_at)
  values ('$SID', '10000000-0000-0000-0000-000000000001', '$U', '*/1 * * * *', 'UTC', '$SLOT');
SQL

# fire NAME COUNT SQL-with-%i: COUNT connections wait on a shared lock, then run together.
fire() {
  local name=$1 n=$2 body=$3
  sql -c "select pg_advisory_lock($LOCK); select pg_sleep(1.5);" >/dev/null &
  sleep 0.3
  for i in $(seq 1 "$n"); do
    sql -c "set role service_role; select pg_advisory_lock_shared($LOCK) is null, pg_advisory_unlock_shared($LOCK) is null;" \
        -c "${body//%i/$i}" >"$out/$name.$i" &
  done
  wait
  cat "$out/$name".* | grep -c '^t$' || true
}
check() { if [ "$2" != "$3" ]; then echo "FAIL: $1: expected $3, got $2"; exit 1; fi; echo "ok: $1 ($2)"; }

# Pre-fill to 90/100 so 30 racers fit under the default max_connections (100).
sql -c "insert into public.usage_counters (user_id, period_start, runs) values ('$U', (date_trunc('month', now() at time zone 'utc'))::date, 90)"
got=$(fire quota 30 "select allowed from public.reserve_run('$U')")
check "30 parallel reserve_run at 90/100 allow exactly 10" "$got" 10
check "usage counter after parallel reservations" "$(sql -c "select runs from public.usage_counters where user_id = '$U'")" 100

got=$(fire activate 10 "select ok from public.set_workflow_active(('10000000-0000-0000-0000-0000000000' || lpad('%i', 2, '0'))::uuid, '$U', true)")
check "10 parallel activations on free plan allow exactly 3" "$got" 3
check "active workflows after parallel activation" "$(sql -c "select count(*) from public.workflows where user_id = '$U' and is_active")" 3

got=$(fire hook 30 "select allowed from public.webhook_hit('$EP', 10, 86400)")
check "30 parallel webhook hits with limit 10 allow exactly 10" "$got" 10

got=$(fire claim 20 "select public.claim_schedule('$SID', '$SLOT', '$SLOT'::timestamptz + interval '1 minute')")
check "20 parallel claims of one schedule slot succeed exactly once" "$got" 1

echo "db-concurrency: all checks passed"
