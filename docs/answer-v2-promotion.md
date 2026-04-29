# Deterministic Answer v2: Promotion + Regression

`deterministic-v2` is the new answer kernel for GBrain.
It is **not the default**; legacy answer rendering stays in place unless you opt in.

## Main commands

- Promotion eval:
  - `bun run src/cli.ts eval answer-v2 --cases <cases.jsonl|json> --synthesis deterministic-v2 --json`
- Chief promotion smoke:
  - `bun run scripts/chief-answer-v2-promotion-eval.ts`
- Chief regression pack:
  - `bun run scripts/chief-answer-v2-regression-pack.ts`

## Privacy defaults

- Raw answer envelopes are **omitted by default** from the regression pack.
- Add `--include-envelopes` only when you explicitly want the full payload.

## Gate interpretation

- `eligible_for_limited_exposure`: promotion smoke passed and v2 is structurally safe enough for limited rollout.
- `keep_hidden`: smoke was skipped or produced no usable cases.

## Common checks

- If recall diagnostics show low `gbs1:` counts, fix retrieval before tuning prose.
- If promotion eval fails on non-`gbs1` citations or artifact strings, the answer is not promotion-safe.
- If the regression pack includes warnings, treat them as quality clues, not automatic failures.

