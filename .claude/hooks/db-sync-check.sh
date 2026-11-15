#!/usr/bin/env bash
# Stop hook: after every task, compare the local database with db/schema.sql + db/migrations
# (node scripts/db.mjs check). On drift, ask Claude once to back up and sync before finishing.
set -euo pipefail

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f scripts/db.mjs ] || exit 0

report=$(node scripts/db.mjs check 2>&1) && exit 0

jq -n --arg report "$report" '{
  decision: "block",
  reason: ("Local database is out of sync with db/schema.sql + migrations:\n" + $report + "\nRun npm run db:backup, then npm run db:setup, then npm run db:check. Objects listed as \"not in schema\" are never dropped automatically: if one is really obsolete, ask the user before removing it (and drop it from any migration that creates it). Then tell the user what you did.")
}'
