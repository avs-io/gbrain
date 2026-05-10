# WP-R60 — GBrain Compact Human Output Closure

## Scope
- Target row: `DET-06` — PR6 promotion/compact output discipline.
- Goal: implement deterministic-v2 compact human rendering in `gbrain answer` while preserving full JSON and strict/default human-mode output.

## Implementation
- `gbrain/src/commands/answer.ts`
  - Added compact-mode branch for deterministic-v2 human output (used by `--compact` / `--citation-density compact`).
  - Kept `--json` path unchanged; `buildDeterministicAnswerEnvelope` output remains full-detail `AnswerEnvelope`.
  - Compact human rendering now shows bounded factual claim lines and bounded provenance summary.
  - Existing strict/default non-compact human behavior remains unchanged.
  - Unsupported unsupported claims are excluded from compact line rendering.
- `gbrain/test/answer/deterministic-answer-smoke.test.ts`
  - Added compact human smoke test asserting bounded provenance and no `quote_hash=` dump.
  - Added strict human-mode regression assertion showing `quote_hash=` remains present without `--compact`.

## Commands run
- `bun test test/answer/deterministic-answer-smoke.test.ts --timeout=60000`
  - Result: `6 pass, 0 fail`.
- `bun test test/answer/*.test.ts --timeout=60000`
  - Result: `73 pass, 0 fail`.
- `bun run typecheck`
  - Result: exit code `0`.

## Row outcome
| Row ID | Recommendation | Rationale |
|---|---|---|
| DET-06 | PASS (narrow scope) | Compact human output now applies deterministic caps and compact citation/provenance rendering without changing JSON detail or strict-mode behavior.

## Recommendation
- `recommended_next_state`: `reducer_pending`.

## Safety
- No external action.
- No trusted memory write.
- No child sessions spawned.
- No deletions.
