#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-garney-local}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-54322}"

echo "Waiting for Postgres on localhost:${POSTGRES_PORT}..."
for _ in $(seq 1 40); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker compose exec -T db psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'role') THEN
    ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
  END IF;
END $$;
SQL

for file in supabase/migrations/*.sql; do
  echo "Applying $file"
  docker compose exec -T db psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$file"
done

echo "Reloading PostgREST schema cache..."
docker compose exec -T db psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
docker compose up -d rest --force-recreate >/dev/null
echo "Migrations applied."
