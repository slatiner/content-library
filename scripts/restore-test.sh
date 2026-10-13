#!/usr/bin/env bash
# Restore test for the weekly backup (#27). Downloads the latest backup artifact,
# decrypts it, and loads it into a throwaway local Supabase (Docker), then counts
# the rows. Nothing touches the live project.
#
#   scripts/restore-test.sh <path to age private key file>
#
# Needs: gh, age (brew install age), Docker running, the Supabase CLI.
set -euo pipefail
key=${1:?usage: scripts/restore-test.sh <age key file>}
key=$(cd "$(dirname "$key")" && pwd)/$(basename "$key")
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'cd "$work" && supabase stop --no-backup >/dev/null 2>&1; rm -rf "$work"' EXIT

run=$(gh run list -R "$(cd "$repo" && gh repo view --json nameWithOwner -q .nameWithOwner)" \
  --workflow backup.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')
[ -n "$run" ] || { echo "No successful backup run found."; exit 1; }
(cd "$repo" && gh run download "$run" -D "$work/artifact")
file=$(find "$work/artifact" -name '*.tgz.age' | head -1)
echo "Restoring $(basename "$file")"
mkdir "$work/dump"
age -d -i "$key" "$file" | tar -C "$work/dump" -xzf -

# A fresh, empty local project (no migrations), like a new Supabase project.
cd "$work"
supabase init >/dev/null
sed -i '' 's/^project_id = .*/project_id = "restore-test"/' supabase/config.toml
supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta,kong,postgrest >/dev/null

db=$(docker ps --format '{{.Names}}' | grep '^supabase_db_restore-test$')
docker cp "$work/dump/." "$db:/tmp/dump"
docker exec "$db" psql -q -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 \
  -f /tmp/dump/roles.sql -f /tmp/dump/schema.sql \
  -c 'SET session_replication_role = replica' -f /tmp/dump/data.sql >/dev/null
echo "Restored. Row counts:"
docker exec "$db" psql -U postgres -d postgres -c \
  "select (select count(*) from public.entries) as entries, (select count(*) from auth.users) as users;"
