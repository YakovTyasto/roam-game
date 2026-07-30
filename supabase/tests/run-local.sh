#!/usr/bin/env bash
# ============================================================================
# Apply the migrations to a throwaway local Postgres and run the verification
# suites. LOCAL ONLY — never point this at a real Supabase project (see the
# warning in 00_local_stubs.sql).
#
#   supabase/tests/run-local.sh                       # clean install, all suites
#   supabase/tests/run-local.sh --upgrade-from 0012   # simulate a production
#                                                     # upgrade: apply 0001-0012,
#                                                     # seed data, then the rest
#   supabase/tests/run-local.sh --only 09             # one suite (still applies
#                                                     # every migration first)
#
# Environment:
#   PGHOST/PGPORT/PGUSER  standard libpq variables (default: /tmp, 5432, postgres)
#   ROAM_TEST_DB          database name to create/drop (default: roam_sql_test)
#
# Why this exists: the suites were previously run by pasting psql commands from
# README.md. That made "which migrations were actually applied before this
# assertion?" a matter of trust, and made the upgrade path (the thing most likely
# to break in production) the least-tested path. This script makes both explicit
# and repeatable.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

DB="${ROAM_TEST_DB:-roam_sql_test}"
PSQL=(psql -v ON_ERROR_STOP=1 --no-psqlrc -q)
UPGRADE_FROM=""
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upgrade-from) UPGRADE_FROM="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

echo "▸ recreating database $DB"
dropdb --if-exists "$DB"
createdb "$DB"

run() { "${PSQL[@]}" -d "$DB" -f "$1"; }

echo "▸ auth/role stubs"
run supabase/tests/00_local_stubs.sql

migrations=(supabase/migrations/*.sql)

if [[ -n "$UPGRADE_FROM" ]]; then
  echo "▸ upgrade path: applying migrations up to $UPGRADE_FROM"
  for m in "${migrations[@]}"; do
    run "$m"
    [[ "$(basename "$m")" == ${UPGRADE_FROM}_* ]] && break
  done

  # Seed rows that look like real production data, so the remaining migrations
  # are proven to run against a populated schema and not just an empty one.
  echo "▸ seeding pre-upgrade production-shaped data"
  "${PSQL[@]}" -d "$DB" <<'SQL'
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001')
  on conflict do nothing;
insert into public.player_profiles (user_id, display_name)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'Legacy Player')
  on conflict do nothing;
insert into public.rate_limits (user_id, action, bucket_start, count)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'legacy', now(), 1)
  on conflict do nothing;
SQL

  echo "▸ applying the remaining migrations on top"
  seen_boundary=0
  for m in "${migrations[@]}"; do
    if [[ $seen_boundary -eq 1 ]]; then run "$m"; fi
    [[ "$(basename "$m")" == ${UPGRADE_FROM}_* ]] && seen_boundary=1
  done

  # The seeded row must survive every later migration untouched.
  "${PSQL[@]}" -d "$DB" -tAc "
    do \$\$
    begin
      if not exists (
        select 1 from public.player_profiles
         where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
           and display_name = 'Legacy Player'
      ) then
        raise exception 'UPGRADE FAILED: pre-existing profile row did not survive';
      end if;
      raise notice 'OK: pre-existing production row survived the upgrade';
    end
    \$\$;"
else
  echo "▸ clean install: applying every migration in order"
  for m in "${migrations[@]}"; do run "$m"; done
fi

echo "▸ running verification suites"
for suite in supabase/tests/[0-9][0-9]_*_verify.sql; do
  name="$(basename "$suite")"
  if [[ -n "$ONLY" && "$name" != ${ONLY}_* ]]; then continue; fi
  echo "── $name"
  run "$suite"
done

echo "✓ all requested suites passed against $DB"
