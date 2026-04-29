# World 8 / Verdict Recall Fix — 2026-04-29

## Diagnosis

- Raw evidence exists and is already indexed as ChatGPT source pages, especially `sources/chatgpt/full-export-all/2025-12-24-analysis-of-project-options-690b6edf`.
- The failing queries mixed approximate memory terms (`World 8`, `real options under uncertainty`) with source terms (`North Star`, `Verdict`, `World Model`). The exact `World 8` phrase does not appear in the relevant transcript.
- Direct literal source phrases worked, e.g. `I don't want rails receipts compliance North Star` and the long summary query. This rules out total source exclusion.
- Failure mode: ranking/recall did not bridge approximate user memory to rare transcript anchors. Hybrid retrieval had no deterministic fallback when the source used different wording, so it could return no useful result or generic Verdict mentions.
- Typed memory was not the root cause; it remains opt-in and only decorates query output when `--with-typed-memory` is supplied.

## Implemented change

- Extended the existing fallback-only concept alias bridge in `src/core/search/concept-alias.ts` with a small built-in evidence alias set for the Verdict / North-Star correction episode.
- Trigger terms include `verdict`, `north star`, `world model`, `decision legitimacy`, `real options`, `uncertainty`, and `world 8`.
- The fallback requires at least two trigger hits, then retries rare source-grounded phrases:
  - `I don't want rails receipts compliance North Star`
  - `Verdict is how I want the world to run world view need not be my north star`
  - `Decision Algebra Active World Model flip conditions Verdict North Star`
- This stays fallback-only: direct search results are preserved; aliases run only after direct keyword/hybrid retrieval is empty.
- No trusted GBrain pages were edited. No memory proposals were enqueued. Typed memory remains opt-in.

## Regression added

- Added a targeted regression in `test/concept-alias-fallback.test.ts`:
  - Query: `World 8 North Star real options uncertainty Verdict`
  - Requires returning `sources/chatgpt/full-export-all/2025-12-24-analysis-of-project-options-690b6edf`
  - Asserts it does not fall back to a generic `Final Verdict` result.

## Validation

Commands run:

```bash
bun test test/concept-alias-fallback.test.ts
bun run build
bun run src/cli.ts query "World 8 North Star real options uncertainty Verdict" --no-expand --limit 5 --with-typed-memory
bun run src/cli.ts query "Verdict decision legitimacy uncertainty options flip conditions World Model" --no-expand --limit 5 --with-typed-memory
```

Results:

- Targeted test: PASS, 6/6.
- Build: PASS.
- Live query now returns the Dec 24 analysis source as top result instead of `No results`.

## Remaining blockers / next improvement

- The returned chunk text is still a compiled/source chunk excerpt, not a clean quote-level snippet around the exact Nov 6 exchange. Retrieval now finds the right source, but answer synthesis still needs source-window extraction for precise citations.
- The better general solution is a raw episode fallback/searcher that can line-window transcript files around matched rare phrases and return those windows as evidence objects. This patch is intentionally smaller and safer: deterministic fallback aliases over already-indexed raw source pages.
