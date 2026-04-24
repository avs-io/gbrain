# GBrain Skill and Convention Index

Load `BOOTSTRAP.md` first. Then load only the sections needed for the current task.

## Core Conventions

- `conventions/brain-first.md`
  - Use before people/company/identity/strategy questions.
- `conventions/brain-first.md` plus source filters
  - Use when the task is clearly about Gmail, calendar, contacts, finance, or browser capture.

## Memory Lenses

- `working`
  - Session-local hints from `~/.openclaw/workspace/memory/`
  - Never overrides sovereign truth
- `personal`
  - Identity, body, capital, network state
- `semantic`
  - Durable decisions, patterns, abstractions
- `operational`
  - `_os/open-loops`, `_os/commitments`, `_os/inbound-opportunities`

## Brain Commands

- `gbrain context-pack "<query>"`
- `gbrain context-pack "<query>" --source-filter gmail|calendar|contacts|finance|browser`
- `gbrain context-pack "<query>" --mode continuity --source-filter notes|openclaw --recent-window 30d`
- `gbrain context-pack "<query>" --mode evidence --source-filter notes|all`
- `gbrain context-pack "<query>" --lens working|personal|semantic|operational`
- `gbrain evidence "<query>" --source-filter notes|all`
- `gbrain continuity doctor|backfill|refresh`
- `gbrain propose-memory --file <proposal.json>`
- `gbrain ingest-source <source_id>`
- `gbrain review list|show|accept|reject|defer|patterns`
