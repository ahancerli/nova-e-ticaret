@AGENTS.md

## Serena (code navigation + project memory)

- This project uses the Serena MCP server (setup: `SERENA_KURULUM.md`). At the start of a coding task call Serena's
  `initial_instructions`, then read memory `core` and only the memories it points to for the task at hand.
- Explore code with Serena's symbol tools (overview → `find_symbol` with body) instead of reading whole files.
- Never edit or import iCloud duplicate files (`* 2.ts`, `* 2.tsx`); see memory `pitfalls`.

## Keeping Serena memories current

When a task is done, if the change affects anything the memories describe — folder/module structure, composition root
(`src/server/app.ts`), core patterns (UnitOfWork, `route()`, DI, audit), commands/scripts, versions/dependencies,
`db/schema.sql` rules, or a newly found pitfall — update the matching file in `.serena/memories/` in the same task
(via Serena `mem.edit_memory` / `mem.write_memory`, following `memory_maintenance`) and tell the user which memory
changed. Skip it for local changes (a bug fix, a UI text, one component). A Stop hook (`.claude/hooks/serena-memory-check.sh`)
reminds you if architecture files changed without a memory update.

## UI / design work

- Whenever the user asks for design work — a new page, component, screen, layout, restyle or any visual change — invoke
  the `frontend-design:frontend-design` skill before writing UI code, without waiting to be asked.
