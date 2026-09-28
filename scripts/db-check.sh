#!/usr/bin/env bash
# Applies the Supabase stub + every migration to an empty PostgreSQL database and runs the SQL test suites.
# Usage: DB="postgresql://postgres@localhost:5432/runchunk_test" scripts/db-check.sh
set -euo pipefail
: "${DB:?set DB to a connection string for an EMPTY database}"
cd "$(dirname "$0")/.."
run() { psql "$DB" -v ON_ERROR_STOP=1 -q -X "$@"; }
run -f supabase/tests/vanilla_postgres_stub.sql
for f in supabase/migrations/*.sql; do run -f "$f"; done
for t in supabase/tests/rls_cross_account.sql supabase/tests/quota_webhook_schedule.sql; do
  run -f "$t" 2>&1 | grep -E "NOTICE:.*all checks passed|ERROR|FAIL" || { echo "no result from $t"; exit 1; }
done
