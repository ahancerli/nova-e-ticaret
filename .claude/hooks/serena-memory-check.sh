#!/usr/bin/env bash
# Stop hook: when architecture-level files changed (uncommitted or unpushed) but no
# .serena/memories/* changed, ask Claude once to check whether the memories need an update.
set -euo pipefail

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

changed=$(
  {
    git diff --name-only HEAD 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
    git diff --name-only '@{u}...HEAD' 2>/dev/null || true
  } | sort -u
)
[ -z "$changed" ] && exit 0

printf '%s\n' "$changed" | grep -q '^\.serena/memories/' && exit 0

arch=$(printf '%s\n' "$changed" | grep -E '^(src/core/|src/server/|src/proxy\.ts$|src/modules/[^/]+/(module|index)\.ts$|src/lib/(order|product)-rules\.ts$|db/schema\.sql$|package\.json$|Dockerfile$|docker-compose[^/]*\.yml$|docker/|deploy/|runtime-env\.d\.ts$|next\.config\.ts$|tsconfig\.json$|eslint\.config\.mjs$|scripts/|tests/integration/(register|hooks|d1-sqlite)\.mjs$)' || true)
[ -z "$arch" ] && exit 0

# Remind once per distinct set of changed architecture files.
stamp="$(git rev-parse --git-dir)/serena-memory-reminded"
sig=$(printf '%s' "$arch" | shasum | cut -d' ' -f1)
[ -f "$stamp" ] && [ "$(cat "$stamp")" = "$sig" ] && exit 0
printf '%s' "$sig" > "$stamp"

files=$(printf '%s' "$arch" | head -15 | tr '\n' ' ')
jq -n --arg files "$files" '{
  decision: "block",
  reason: ("Architecture-level files changed without a Serena memory update: " + $files + "— check whether .serena/memories (core, tech_stack, conventions, suggested_commands, task_completion, pitfalls) still match; update the affected memory via Serena mem.edit_memory/write_memory, or state briefly that no update is needed. Then tell the user what you did.")
}'
