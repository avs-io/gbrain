# PORT FOUNDATION STATUS — ops kernel system + CLI commands

**Agent:** FOUNDATION  
**Date:** 2026-05-10  
**Source:** `~/.openclaw/workspace/gbrain` (VERSION 0.22.5)  
**Target:** `~/gbrain-sync` (fresh upstream v0.30.2, branch eonic/intelligence-ops)

---

## Executive Summary

The upstream v0.30.2 has **no** `src/core/ops/` directory and **no** custom commands (`ops.ts`, `radar.ts`, `scout.ts`, `topics.ts`). It also lacks the supporting modules that the ops files import:
- `src/core/radar/` — missing (target has `src/core/ai/`)
- `src/core/scout/` — missing
- `src/tasks/` — missing (target has no `tasks/` dir)
- `src/core/actions/` — missing

All 12 files are **net-new additions** to the upstream codebase. No conflicts. Port complexity is **simple** for most files (stand-alone TypeScript with no engine coupling), with a few files that depend on missing supporting modules and will need stub implementations.

---

## Target v0.30.2 Structure Check

| Path | Exists? |
|------|---------|
| `src/core/ops/` | **NO** — must be created |
| `src/commands/ops.ts` | **NO** |
| `src/commands/radar.ts` | **NO** |
| `src/commands/scout.ts` | **NO** |
| `src/commands/topics.ts` | **NO** |
| `src/core/radar/` | **NO** |
| `src/core/scout/` | **NO** |
| `src/tasks/` | **NO** |
| `src/core/actions/` | **NO** |

---

## File-by-File Port Analysis

### 1. `src/core/ops/kernel.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/kernel.ts` |
| Target | `~/gbrain-sync/src/core/ops/kernel.ts` (NEW) |
| Lines | 3,110 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE — pure file-based ops store (JSONL + YAML), no BrainEngine dependency |
| Engine API changes | N/A — this file is engine-agnostic |
| Imports from gbrain | `../config.ts` (configDir), `node:fs`, `node:path`, `node:crypto` only |
| Modifications needed | None |

**What it does:** Core dispatcher + CLI runtime for the "Always-On Intelligence OS". Defines all schemas (OpsProgram, OpsWorkItem, OpsWorkRun, OpsLease, etc.), manages a JSONL-based ops store, implements the supervisor tick loop, work item lifecycle (propose/lease/run/complete), roadmaps, worker profiles, topic tracks, and budget ledger. Exports ~40+ named functions used by `ops.ts` command.

---

### 2. `src/core/ops/opportunity-radar.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/opportunity-radar.ts` |
| Target | `~/gbrain-sync/src/core/ops/opportunity-radar.ts` (NEW) |
| Lines | 362 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Engine API changes | N/A |
| Imports | `../config.ts` (configDir), `node:fs`, `node:crypto` only |
| Modifications needed | None |

**What it does:** Processes incoming opportunity signals (world deltas, old memories, active projects), scores and classifies candidates, writes reports and feedback to JSONL stores, computes brief-ready surfaces.

---

### 3. `src/core/ops/opportunity-radar-v2.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/opportunity-radar-v2.ts` |
| Target | `~/gbrain-sync/src/core/ops/opportunity-radar-v2.ts` (NEW) |
| Lines | 365 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only |
| Modifications needed | None |

**What it does:** Enhanced v2 of opportunity radar with multi-source ingestion (from-state, from-delta, from-bookmarks, from-reduction, from-memory-context), richer scoring, and structured report output.

---

### 4. `src/core/ops/bookmark-action-radar.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/bookmark-action-radar.ts` |
| Target | `~/gbrain-sync/src/core/ops/bookmark-action-radar.ts` (NEW) |
| Lines | 268 |
| Port complexity | **MEDIUM** |
| Upstream conflicts | NONE |
| **Key dependency** | `../../tasks/bookmarks-agent-core.ts` — **`tasks/` dir does not exist in v0.30.2** |
| Modifications needed | Must create a stub for `bookmarks-agent-core.ts` or extract the needed exports (classifyBookmarkItem, dedupeRawBookmarks, parseBookmarkMarkdown, RawBookmarkItem, StructuredBookmarkSignal) |

**What it does:** Reads bookmark batch files, classifies bookmarks with decision outcomes (ignore/archive/remember/investigate/act/interrupt), enqueues work packets into the ops store.

---

### 5. `src/core/ops/bookmark-deep-radar.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/bookmark-deep-radar.ts` |
| Target | `~/gbrain-sync/src/core/ops/bookmark-deep-radar.ts` (NEW) |
| Lines | 285 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only (no missing deps) |
| Modifications needed | None |

**What it does:** Deep-radar variant that takes bookmark input + artifact store, performs deeper analysis, writes structured reports. Stand-alone file I/O.

---

### 6. `src/core/ops/briefing-surfaces.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/briefing-surfaces.ts` |
| Target | `~/gbrain-sync/src/core/ops/briefing-surfaces.ts` (NEW) |
| Lines | 302 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only |
| Modifications needed | None |

**What it does:** Builds three briefing surfaces: morning brief, daily-build report, weekly strategy synthesis. Pure text/markdown generation, no engine deps.

---

### 7. `src/core/ops/liveness.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/liveness.ts` |
| Target | `~/gbrain-sync/src/core/ops/liveness.ts` (NEW) |
| Lines | 352 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node + imports from `kernel.ts` (types only, no engine) |
| Modifications needed | None |

**What it does:** LaunchAgent plist installation for macOS auto-start, heartbeat checks, heartbeat template markdown generation. File-system only.

---

### 8. `src/core/ops/meeting-transcript-actions.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/meeting-transcript-actions.ts` |
| Target | `~/gbrain-sync/src/core/ops/meeting-transcript-actions.ts` (NEW) |
| Lines | 346 |
| Port complexity | **MEDIUM** |
| Upstream conflicts | NONE |
| **Key dependency** | `../actions/proposals.ts` — **`actions/` dir does not exist in v0.30.2** |
| Modifications needed | Must create a stub for `proposals.ts` or extract the needed exports (appendActionProposal, buildActionProposal, ActionProposal) |

**What it does:** Reads meeting transcript files, extracts action items (commitments, follow-ups, reminders), writes action proposals and reports to JSONL stores.

---

### 9. `src/core/ops/report-reducer.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/core/ops/report-reducer.ts` |
| Target | `~/gbrain-sync/src/core/ops/report-reducer.ts` (NEW) |
| Lines | 264 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only |
| Modifications needed | None |

**What it does:** Reduces report artifacts into structured candidates for topics, opportunities, and action work items. Audits unreduced artifacts. Pure file I/O.

---

### 10. `src/commands/ops.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/commands/ops.ts` |
| Target | `~/gbrain-sync/src/commands/ops.ts` (NEW) |
| Lines | 678 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Key imports | kernel.ts (all ops functions), liveness.ts, bookmark-action-radar.ts, bookmark-deep-radar.ts, meeting-transcript-actions.ts, opportunity-radar.ts, opportunity-radar-v2.ts, report-reducer.ts, briefing-surfaces.ts, **topic-track-cycle.ts from scout/** |
| **Key dependency** | `../core/scout/topic-track-cycle.ts` — **`scout/` dir does not exist in v0.30.2** |
| Modifications needed | Must create stub for `topic-track-cycle.ts` (only `runTopicTrackScoutCycle` is needed by ops) |

**What it does:** CLI entry point for all `gbrain ops ...` commands. Implements subcommands: init, status, programs (list/sync/seed-work), workers (list/sync), topic-tracks (list/sync), scout cycle, bookmarks radar, meetings extract, opportunities radar/v2, reports reduce/audit-unreduced, brief (morning/daily-build/weekly-strategy), pause/resume, kill-switch, dashboard, metrics.

---

### 11. `src/commands/radar.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/commands/radar.ts` |
| Target | `~/gbrain-sync/src/commands/radar.ts` (NEW) |
| Lines | 105 |
| Port complexity | **MEDIUM** |
| Upstream conflicts | NONE |
| **Key dependencies** | `../core/radar/opportunity.ts` and `../core/radar/surfacing.ts` — **`radar/` dir does not exist in v0.30.2** |
| Modifications needed | Must create `src/core/radar/opportunity.ts` and `src/core/radar/surfacing.ts` stubs |

**What it does:** CLI for `gbrain radar review/accept/dismiss/opportunity`. Interfaces with surfacing candidates store and converts scout signals to opportunity reports.

---

### 12. `src/commands/scout.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/commands/scout.ts` |
| Target | `~/gbrain-sync/src/commands/scout.ts` (NEW) |
| Lines | 153 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only |
| Modifications needed | None |

**What it does:** CLI for `gbrain scout` commands. Stand-alone file, no missing deps visible.

---

### 13. `src/commands/topics.ts`

| Field | Value |
|-------|-------|
| Source | `~/.openclaw/workspace/gbrain/src/commands/topics.ts` |
| Target | `~/gbrain-sync/src/commands/topics.ts` (NEW) |
| Lines | 296 |
| Port complexity | **SIMPLE** |
| Upstream conflicts | NONE |
| Imports | Standard Node only |
| Modifications needed | None |

**What it does:** CLI for `gbrain topics` commands. Stand-alone file, no missing deps visible.

---

## Supporting Modules That Need Stubbing

| Stub Path | Needed By | Needed Exports |
|-----------|-----------|----------------|
| `src/tasks/bookmarks-agent-core.ts` | `bookmark-action-radar.ts` | classifyBookmarkItem, dedupeRawBookmarks, parseBookmarkMarkdown, RawBookmarkItem, StructuredBookmarkSignal |
| `src/core/actions/proposals.ts` | `meeting-transcript-actions.ts` | appendActionProposal, buildActionProposal, ActionProposal |
| `src/core/scout/topic-track-cycle.ts` | `ops.ts` | runTopicTrackScoutCycle |
| `src/core/radar/opportunity.ts` | `radar.ts` | candidateFromScoutSignal, opportunityReportJson |
| `src/core/radar/surfacing.ts` | `radar.ts` | appendSurfacingCandidates, generateSurfacingCandidates, parseSurfacingFixture, readSurfacingStore, recordSurfacingDecision, surfacingCandidatesPath, SurfacingCandidate |

---

## Engine API Differences (v0.22.5 → v0.30.2)

**Finding: The ops files do NOT use the BrainEngine interface directly.**

The `kernel.ts` is a pure in-memory/file-JSONL store with no DB calls. All 12 files operate exclusively on the filesystem (readFileSync, writeFileSync, appendFileSync) and use JSON/YAML parsing. There are **zero imports** of BrainEngine, db helpers, search interfaces, or page operations.

This means:
- **No engine interface migration is needed** for these files
- They will compile and run against any version of gbrain that has the same file-system layout
- The primary port risk is missing supporting modules (tasks/, actions/, scout/, radar/) not the engine API

---

## Summary Table

| # | Source Path | Target Path | Size | Complexity | Engine Conflict | Missing Deps |
|---|-------------|-------------|------|------------|-----------------|--------------|
| 1 | `src/core/ops/kernel.ts` | `src/core/ops/kernel.ts` | 3,110 L | SIMPLE | NONE | None |
| 2 | `src/core/ops/opportunity-radar.ts` | `src/core/ops/opportunity-radar.ts` | 362 L | SIMPLE | NONE | None |
| 3 | `src/core/ops/opportunity-radar-v2.ts` | `src/core/ops/opportunity-radar-v2.ts` | 365 L | SIMPLE | NONE | None |
| 4 | `src/core/ops/bookmark-action-radar.ts` | `src/core/ops/bookmark-action-radar.ts` | 268 L | MEDIUM | NONE | tasks/bookmarks-agent-core.ts |
| 5 | `src/core/ops/bookmark-deep-radar.ts` | `src/core/ops/bookmark-deep-radar.ts` | 285 L | SIMPLE | NONE | None |
| 6 | `src/core/ops/briefing-surfaces.ts` | `src/core/ops/briefing-surfaces.ts` | 302 L | SIMPLE | NONE | None |
| 7 | `src/core/ops/liveness.ts` | `src/core/ops/liveness.ts` | 352 L | SIMPLE | NONE | None |
| 8 | `src/core/ops/meeting-transcript-actions.ts` | `src/core/ops/meeting-transcript-actions.ts` | 346 L | MEDIUM | NONE | core/actions/proposals.ts |
| 9 | `src/core/ops/report-reducer.ts` | `src/core/ops/report-reducer.ts` | 264 L | SIMPLE | NONE | None |
| 10 | `src/commands/ops.ts` | `src/commands/ops.ts` | 678 L | SIMPLE | NONE | core/scout/topic-track-cycle.ts |
| 11 | `src/commands/radar.ts` | `src/commands/radar.ts` | 105 L | MEDIUM | NONE | core/radar/{opportunity,surfacing}.ts |
| 12 | `src/commands/scout.ts` | `src/commands/scout.ts` | 153 L | SIMPLE | NONE | None |
| 13 | `src/commands/topics.ts` | `src/commands/topics.ts` | 296 L | SIMPLE | NONE | None |

**Total: 13 files, 6,884 lines**

---

## Action Items

1. **Create directory structure:**
   - `mkdir -p ~/gbrain-sync/src/core/ops/`
   - `mkdir -p ~/gbrain-sync/src/core/radar/`
   - `mkdir -p ~/gbrain-sync/src/core/scout/`
   - `mkdir -p ~/gbrain-sync/src/tasks/`
   - `mkdir -p ~/gbrain-sync/src/core/actions/`

2. **Create stub modules** for the 5 missing supporting modules (see table above) — these only need to export the specific functions/types used by the ops files

3. **Copy all 13 files** from source to target

4. **Verify TypeScript compilation** — run `bun build` or `tsc --noEmit` to catch any remaining import issues

---

*Report generated by FOUNDATION agent. Next: AGGREGATOR agent to synthesize with other domain ports.*