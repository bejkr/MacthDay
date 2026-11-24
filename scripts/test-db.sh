#!/usr/bin/env bash
# Spustí migrácie a RLS testy na čistom lokálnom PostgreSQL (bez Dockeru).
# Použitie: PGPORT=5432 PGUSER=postgres bash scripts/test-db.sh
# Vytvorí a na konci zmaže databázu "matchday_test". V clusteri po sebe nechá iba
# tri prázdne roly (anon, authenticated, service_role), ktoré používa aj Supabase.
set -euo pipefail
cd "$(dirname "$0")/.."

DB=matchday_test
export PGUSER="${PGUSER:-postgres}"

dropdb --if-exists "$DB"
createdb "$DB"

run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

run supabase/tests/00_plain_postgres_stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  run "$f"
done
echo "→ supabase/tests/rls.test.sql"
run supabase/tests/rls.test.sql

dropdb "$DB"
# Roly anon / authenticated / service_role v clusteri ostávajú (sú prázdne a neškodné).
echo "HOTOVO: migrácie aj RLS testy prešli."
