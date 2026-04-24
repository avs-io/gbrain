# GBrain Bootstrap

Load this first. Load deeper docs only when the task requires them.

## Sovereign Brain Contract

- The sovereign brain at `/Users/a/Documents/brain-wiki` is the only durable truth authority.
- OpenClaw is a thin overlay. Workspace memory is helpful, but not authoritative.
- Read trusted memory through:
  - `gbrain context-pack "<query>"`
  - add `--source-filter gmail|calendar|contacts|finance|browser` for source-specific questions
  - add `--lens working|personal|semantic|operational` only when the task clearly needs a memory lens
  - add `--mode continuity --source-filter notes|openclaw --recent-window 30d` for recent thinking continuity
  - add `--mode evidence` or `gbrain evidence "<query>" --source-filter notes|all` for exact old wording or file recall
- Use `gbrain get <slug>` only when the page slug is already known.
- Use `gbrain query "<question>" --no-expand` for broader exploration.

## Write-Back Contract

- Durable write-back goes only through `gbrain propose-memory`.
- External source ingest goes only through `gbrain ingest-source <source_id>`.
- Continuity refresh goes through `gbrain continuity refresh --fast` or `gbrain continuity backfill <source_id>`.
- Never edit trusted brain pages directly from workspace memory.
- Never invent a parallel `.agent`-style memory authority.

## Operational Defaults

- For blockers, follow-ups, and unresolved workstreams, prefer `_os/open-loops`.
- For inbox-derived obligations or opportunities, prefer:
  - `gbrain context-pack "<query>" --source-filter gmail --lens operational`
- For recent note-derived reasoning, prefer:
  - `gbrain context-pack "<query>" --mode continuity --source-filter notes`
- Use history pages only when the user is explicitly asking about change over time.

## On-Demand Docs

- Skill and convention index: `~/.openclaw/workspace/gbrain/skills/INDEX.md`
- Brain-first lookup convention: `~/.openclaw/workspace/gbrain/skills/conventions/brain-first.md`
- Private long-term memory: `~/.openclaw/workspace/MEMORY.md`
