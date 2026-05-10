# WP-R64-GBRAIN-MODEL-CALL-AUDIT-GLOBAL-GUARD (RDEP-15)

## Scope
Implemented deterministic global guard for known GBrain model/LLM-call entrypoints so audit metadata is required and fail-closed.

## What changed
- Hardened `src/core/ai/model-call-audit.ts`:
  - Added strict provider allowlist (`qwen-local`, `minimax-m27`, `codex`, `gpt-pro`, `claude-pro`, `local`).
  - Added strict privacy validation (`P0_PRIVATE_RAW|P1_PRIVATE|P2_PRIVATE|P3_PUBLIC`).
  - Enforced non-empty `input_refs`.
  - Enforced `output_refs` non-empty when status is `completed`.
  - Enforced `prompt_hash` via sha256 and fail-closed record validation.
  - Enforced P0/P1 redact/not-retain (`raw_prompt_retained=false`).
  - Added known entrypoint contract:
    - `KNOWN_MODEL_CALL_ENTRYPOINTS = ['prepareProviderRun','runLocalIntelligenceJob']`
    - `requireEntrypointAudit(...)` fail-closed gate.
- Wired known entrypoints to mandatory audit contract:
  - `src/core/ai/provider-runner.ts`: `prepareProviderRun` now requires `audit` and calls `requireEntrypointAudit`.
  - `src/core/ai/local-runner.ts`: `runLocalIntelligenceJob` now requires `options.audit` and calls `requireEntrypointAudit`.
- Updated CLI call paths to pass mandatory audit metadata:
  - `src/commands/ai.ts` now builds deterministic audit envelopes for `ai provider prepare` and `ai jobs run`.
- Added/extended focused tests:
  - `test/intelligence-jobs-model-call-audit.test.ts`
    - P3 valid record includes provider/model/prompt_hash/input_refs/output_refs.
    - P0/P1 redaction/no raw retain enforced.
    - completed-without-output_refs fails.
    - known entrypoints fail closed without audit metadata.
    - unknown provider / empty refs / missing privacy fail closed.
  - Updated `test/ai/provider-runner.test.ts` and `test/ai/local-runner.test.ts` to satisfy required audited-entrypoint contract.

## Safety constraints
- No live provider/model network calls were added.
- No external actions added.
- No trusted memory writes added.
- No child sessions used.
- P0/P1 raw prompt retention remains blocked.

## Gate results
- `bun test test/intelligence-jobs-model-call-audit.test.ts --timeout=60000` : PASS (7/7)
- `bun test test/ai/provider-runner.test.ts test/ai/local-runner.test.ts --timeout=60000` : PASS (9/9)
- `bun run typecheck` : PASS

## RDEP-15 verdict
PASS for target row RDEP-15: known model/LLM-call entrypoints are now deterministically gated to require audited metadata, with fail-closed validation on provider/privacy/refs/output requirements and prompt hashing/redaction policy.
