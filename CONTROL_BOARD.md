# GBrain Control Board

**Last Health Check:** 2026-04-28 12:34 IST
**Status:** 🔴 CLI FAILED

## Health Metrics

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Pages | 9,336 | — | ✅ |
| Links | 13,088 | > 200 | ✅ |
| Orphans | 663 | < 8,000 | ✅ |
| Sync Failures | 1 | = 0 | ❌ |
| Last Dream | 0.3h ago | < 2h | ✅ |
| Upstream | true | informational | ℹ️ |

## Notes

- **upstreamAhead: true** — New upstream branches since last check: `fix/mcp-registration-auth`, `fix/schema-verify`, `garrytan/storage-tiering`. `fix/sync-cycle-source-id` updated (3c012bc..4d5c477). Expected for dev fork (`/Users/a/Documents/gbrain-avs`). Not a failure condition.
- Owner CLI failed to start: `bun run src/tasks/gbrain-owner-cli.ts` → `error: Module not found "src/tasks/gbrain-owner-cli.ts"`.
- Dream freshness: last known dream cycle ran at 11:04 IST; graph was stable (0 pages extracted, 0 orphans found).
- No sync ever run (no `sync.last_run`). All 9,334 pages local-only. No upstream baseline.
- No sync failures. No dead links below threshold. No orphan explosion.

## Next Actions

- Consider merging `avs-upstream/main` when ready (new branches: mcp-auth, schema-verify, storage-tiering; updated: sync-cycle-source-id).
- Plan initial sync to establish upstream baseline (no `sync.last_run` exists).
- Restore or locate `src/tasks/gbrain-owner-cli.ts`, then rerun the owner check.
