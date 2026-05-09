# PORT INTELLIGENCE STATUS

**Source:** `~/.openclaw/workspace/gbrain` (v0.22.5)  
**Target:** `~/gbrain-sync` (v0.30.2, branch `eonic/intelligence-ops`)  
**Agent:** INTELLIGENCE (scout pipeline + signal surfacing)

---

## Executive Summary

The v0.22.5 intelligence system is a **full exogenous signal surfacing pipeline** — scout recipes that monitor public sources, generate observations, convert them to radar candidates, and feed into topic-state compilation. Upstream v0.30.2 has **none of these directories**: no `scout/`, `evidence/`, `claims/`, `world/`, `radar/`, `actions/`, or `ops/`. The v0.29 "salience" feature is **unrelated** — it ranks pages by emotional weight + recency for the `/salience` command, not signal surfacing.

**Port complexity: HARD** — multiple cross-cutting dependencies, and `topic-track-cycle.ts` depends on `src/core/ops/kernel.ts` which must be ported first (it's a 167KB custom file not present in upstream).

---

## Upstream v0.30.2 Feature Check

| Feature | Status in v0.30.2 | Notes |
|---------|-------------------|-------|
| Scout recipes / pipeline | ❌ Absent | No `src/core/scout/` directory |
| Scout runner | ❌ Absent | No `src/core/scout/runner.ts` |
| Radar signal surfacing | ❌ Absent | No `src/core/radar/` directory |
| Topic-track → scout cycle | ❌ Absent | No `src/core/scout/topic-track-cycle.ts` |
| Evidence system | ❌ Absent | No `src/core/evidence/` |
| Claim ledger | ❌ Absent | No `src/core/claims/` |
| World extraction | ❌ Absent | No `src/core/world/` |
| Intelligence hygiene | ❌ Absent | No `src/core/intelligence/data-hygiene.ts` |
| Eval policy validation | ❌ Absent | No `src/core/intelligence/eval-policy.ts` |
| Namespace/privacy policy | ❌ Absent | No `src/core/intelligence/policy.ts` |
| **Salience (v0.29)** | ✅ Present | `src/commands/salience.ts` + `engine.getRecentSalience()` — unrelated to scout/radar |
| Anomaly detection | ✅ Present | `src/core/cycle/anomaly.ts` — pure stats functions, unrelated |
| `get_recent_salience` op | ✅ Present | v0.29 new operation in `operations.ts` |
| `find_anomalies` op | ✅ Present | v0.29 new operation in `operations.ts` |
| `ops/kernel.ts` | ❌ Absent | Custom 167KB file, not in upstream |

---

## File-by-File Audit

### 1. `src/core/answer/signal-cluster.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/answer/signal-cluster.ts`  
**Target path:** `~/gbrain-sync/src/core/answer/signal-cluster.ts` (or `src/core/intelligence/signal-cluster.ts`)  
**Lines:** 166  
**Port complexity:** MEDIUM

**What it does:**
Clusters evidence signals by answer slot, groups by entity/concept/episode/date, deduplicates, scores by slot-specific heuristics (incidents, stack, relationship_frame, rationale, later_state, etc.), and produces `SlotSignalCluster[]` for the answer synthesis pipeline.

**Upstream dependencies:**
- `src/core/answer/synthesis-dsl.ts` — `AnswerShapeDef`, `RequestedAspect`
- `src/core/answer/evidence-classify.ts` — `EvidenceSignal`, `EvidenceSignalRole`

**Upstream conflicts:**
- `evidence-classify.ts` exists in v0.22.5 but may have a different interface in v0.30.2 (see "Engine Interface Differences" below)
- `synthesis-dsl.ts` may also differ

**Modifications needed:**
- Verify `EvidenceSignal` interface compatibility between versions
- Check if `slotSignalScore()` heuristics (regexes for incidents, stack, etc.) are still valid or if the answer shape system has changed

---

### 2. `src/core/memory/scoutnet.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/memory/scoutnet.ts`  
**Target path:** `~/gbrain-sync/src/core/memory/scoutnet.ts`  
**Lines:** 370  
**Port complexity:** MEDIUM

**What it does:**
Defines the scout recipe, observation, and coverage report schemas; validates them; provides `runScoutDryRun()`, `buildScoutCoverageReport()`, `loadScoutInputs()`, and `scoutDefaultsFor()`. This is the **schema + validation layer** for the scout system.

**Upstream dependencies:**
- `src/core/memory/namespace-policy.ts` — `classifyNamespacePolicy`, `validateNamespacePolicy`, `GBrainNamespace`, `GBrainPrivacy`, `GBrainSensitivity`
- Node.js `crypto` and `fs` (standard)

**Upstream conflicts:**
- `namespace-policy.ts` exists in v0.22.5 — need to check if it exists in v0.30.2 and if interfaces match
- This file defines its own `SCOUT_RECIPE_SCHEMA = 'gbrain.scout.recipe.v1'` etc. — no direct conflict with upstream

**Modifications needed:**
- Check `namespace-policy.ts` presence/interface in v0.30.2
- The `loadJsonFile()` helper uses `readFileSync` — would need async version for port

---

### 3. `src/core/memory/radar.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/memory/radar.ts`  
**Target path:** `~/gbrain-sync/src/core/memory/radar.ts`  
**Lines:** 264  
**Port complexity:** MEDIUM

**What it does:**
Defines radar candidate and report schemas; scoring functions (relevance, utility, timing, novelty, confidence, annoyance_risk, sensitivity_risk, action_cost); band assignment (`immediate-review` / `daily-brief` / `weekly-digest` / `archive`); converts `ScoutObservation` → `RadarCandidate` and `ClaimLedgerRecord` → `RadarCandidate`; `scoreRadarCandidates()`, `buildRadarReport()`.

**Upstream dependencies:**
- `src/core/claims/claim-ledger.ts` — `ClaimLedgerRecord`
- `src/core/memory/namespace-policy.ts` — same as scoutnet
- `src/core/memory/scoutnet.ts` — `ScoutObservation`, `ScoutNextActionType`

**Upstream conflicts:**
- `claims/claim-ledger.ts` does NOT exist in upstream — major blocker
- `namespace-policy.ts` may or may not exist in upstream

**Modifications needed:**
- `ClaimLedgerRecord` type must be ported or stubbed first
- Depends on `scoutnet.ts` being ported first

---

### 4. `src/core/intelligence/policy.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/intelligence/policy.ts`  
**Target path:** `~/gbrain-sync/src/core/intelligence/policy.ts` (NEW)  
**Lines:** 92  
**Port complexity:** SIMPLE

**What it does:**
Defines `NAMESPACES`, `PRIVACY_TIERS`, `AUTHORITY_TIERS`, `SUPPORT_LEVELS`, `FRESHNESS_POLICY_MODES` constants + types; `isNamespace`, `isPrivacyTier`, `isAuthorityTier` validators; `toLegacyAiPrivacyTier` / `fromLegacyAiPrivacyTier` converters; `explainProviderPolicy()` and `canSendToProvider()` for provider privacy decisions.

**Upstream dependencies:**
- None (pure type/logic definitions)

**Upstream conflicts:**
- Check if `GBrainNamespace` etc. already exist in upstream
- The `PRIVACY_TIERS` values (`P0_LOCAL_ONLY`, `P1_PRIVATE`, `P2_LIMITED_CLOUD`, `P3_PUBLIC`) may or may not match upstream's privacy system

**Modifications needed:**
- Verify no duplicate type definitions in upstream
- May need renaming to avoid collision (e.g., `IntelligenceNamespace` vs `GBrainNamespace`)

---

### 5. `src/core/intelligence/eval-policy.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/intelligence/eval-policy.ts`  
**Target path:** `~/gbrain-sync/src/core/intelligence/eval-policy.ts` (NEW)  
**Lines:** 126  
**Port complexity:** SIMPLE

**What it does:**
Defines `EvalWorkflowType` (includes `scout`, `radar`, `governance` among others); `EvalCaseMeta`, `EvalPolicyViolation`, `EvalPolicyReport` types; `validateEvalPolicy()` — validates eval suite diversity (class dominance ≤25%, requires negative/abstention, requires holdout at 4+ cases, requires 2+ workflow types, 2+ namespaces).

**Upstream dependencies:**
- `src/core/intelligence/policy.ts` — `Namespace as EvalNamespace`, `PrivacyTier as EvalPrivacyTier`

**Upstream conflicts:**
- No `src/core/intelligence/` directory exists in upstream — safe to create
- `EvalWorkflowType` includes `scout` and `radar` — these workflow types may not make sense without the scout/radar systems

**Modifications needed:**
- Depends on `policy.ts` being ported first
- May need to add stub definitions for `scout`/`radar` workflow types if those systems aren't fully ported

---

### 6. `src/core/intelligence/data-hygiene.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/intelligence/data-hygiene.ts`  
**Target path:** `~/gbrain-sync/src/core/intelligence/data-hygiene.ts` (NEW)  
**Lines:** 185  
**Port complexity:** HARD

**What it does:**
Analyzes intelligence substrate store health: `timeline_coverage`, `source_span_resolution_coverage`, `claim_evidence_coverage`, `stale_topic_surfaces`, `privacy_route_violations`. Reads from `configDir()` store paths. Functions: `backfillTimelineEntriesFromExtractions()`, `analyzeIntelligenceSubstrateStores()`, `readWorldExtractionReports()`.

**Upstream dependencies:**
- `src/core/config.ts` — `configDir()`
- `src/core/evidence/source-bridge.ts` — `parseSourceSpanRef`
- `src/core/world/topic-state.ts` — `readWorldExtractionFile`, `synthesisSurfacesPath`, `TopicStateSurface`
- `src/core/world/extractor.ts` — `WorldExtractionReport`, `CandidateSourceRef`
- `src/core/claims/claim-ledger.ts` — `claimLedgerPath`, `ClaimLedgerRecord`
- `src/core/radar/surfacing.ts` — `surfacingCandidatesPath`, `SurfacingCandidate`
- `src/core/actions/proposals.ts` — `actionProposalsPath`, `ActionProposal`

**Upstream conflicts:**
- **All dependencies are absent in upstream** — `evidence/`, `world/`, `claims/`, `radar/`, `actions/` all missing
- `configDir()` exists in upstream

**Modifications needed:**
- All referenced modules (`source-bridge.ts`, `topic-state.ts`, `extractor.ts`, `claim-ledger.ts`, `surfacing.ts`, `proposals.ts`) must be stubbed or ported first

---

### 7. `src/core/intelligence/substrate-provider.ts`

**Status:** ❌ **FILE DOES NOT EXIST** in v0.22.5 source. Listed in the task but not present. Either the task description was aspirational, or the file was removed before v0.22.5 snapshot.

---

### 8. `src/core/intelligence/source-item-span-bridge.ts`

**Status:** ❌ **FILE DOES NOT EXIST** in v0.22.5 source. Listed in the task but not present. Same as above.

---

### 9. Scout Recipe Registry — `src/core/scout/pipeline.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/scout/pipeline.ts`  
**Target path:** `~/gbrain-sync/src/core/scout/pipeline.ts` (NEW)  
**Lines:** 446  
**Port complexity:** HARD

**What it does:**
Defines `ScoutRecipe`, `TopicTrack`, `ScoutQueryPlan`, `ScoutSignal`, `ScoutSuggestedAction` interfaces; `validateTopicTrack()`, `validateScoutRecipe()`, `validateScoutRecipes()`; `buildScoutQueryPlan()`, `buildScoutSignalFromSource()`, `scoutReportJson()`; `BUILTIN_SCOUT_RECIPES` (4 recipes: sovereign-ai-india, agent-memory-systems, ai-agent-infra, health-os-personalization); `scoutRecipeById()`, `listTopicTracks()`.

**Upstream dependencies:**
- Node.js `crypto`
- No internal dependencies (self-contained schema + logic)

**Upstream conflicts:**
- No `src/core/scout/` directory in upstream
- `ScoutRecipe` schema `'gbrain.scout.recipe.v1'` is custom
- `BUILTIN_SCOUT_RECIPES` are domain-specific (India AI, agent memory, etc.) — may need replacement

**Modifications needed:**
- Create `src/core/scout/` directory in upstream
- `runPublicScout()` in `runner.ts` depends on `source-bridge.ts` (web source item construction) — needs evidence system
- May need to adjust for any upstream engine interface differences

---

### 10. Public Scout Runner — `src/core/scout/runner.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/scout/runner.ts`  
**Target path:** `~/gbrain-sync/src/core/scout/runner.ts` (NEW)  
**Lines:** 239  
**Port complexity:** HARD

**What it does:**
`runPublicScout()` — takes a `ScoutRecipe` + source inputs, validates/rejects private sources, creates `SourceItemRecord` and `SourceSpanRecord` via `webSourceItem()` and `sourceSpanForWebText()`, builds `ScoutSignal` via `buildScoutSignalFromSource()`, returns `ScoutRunReport` with run ledger, diagnostics, signals.

**Upstream dependencies:**
- `src/core/evidence/source-bridge.ts` — `sourceSpanForWebText`, `webSourceItem`, `SourceItemRecord`, `SourceSpanRecord`

**Upstream conflicts:**
- `evidence/source-bridge.ts` does NOT exist in upstream
- `SourceItemRecord`, `SourceSpanRecord` types are not defined in upstream

**Modifications needed:**
- `source-bridge.ts` must be ported first (or stubbed)
- Privacy validation logic (`rejectReason()`) uses `P0`, `P1`, `P0_LOCAL_ONLY`, `P1_PRIVATE` — check if upstream privacy tier system is compatible

---

### 11. Topic-Track Scout Cycle — `src/core/scout/topic-track-cycle.ts`

**Source path:** `~/.openclaw/workspace/gbrain/src/core/scout/topic-track-cycle.ts`  
**Target path:** `~/gbrain-sync/src/core/scout/topic-track-cycle.ts` (NEW)  
**Lines:** 184  
**Port complexity:** HARD — **BLOCKED by `ops/kernel.ts` dependency**

**What it does:**
`runTopicTrackScoutCycle()` — reads `OpsTopicTrack` from ops state, queues seed queries + fetched sources to the scout source queue, runs public scout, extracts world candidates, compiles topic state, generates surfacing candidates.

**Critical dependency:**
```typescript
import { readOpsState, upsertScoutSourceQueueItem, type OpsTopicTrack } from '../ops/kernel.ts';
```

**`src/core/ops/kernel.ts` is a 167KB custom file** that is NOT present in upstream v0.30.2. This file must be ported first, but it's a massive undertaking (roadmap flows, work runs, leases, supervisor ticks, worker profiles, topic tracks, source targets, scout source queue, control events, budget ledgers, dispatch packets...).

**Upstream dependencies:**
- `src/core/ops/kernel.ts` — `readOpsState`, `upsertScoutSourceQueueItem`, `OpsTopicTrack`, `OpsStoreOptions`
- `src/core/scout/pipeline.ts` — `scoutRecipeById`
- `src/core/scout/runner.ts` — `runPublicScout`
- `src/core/world/extractor.ts` — `extractWorldCandidatesFromScout`
- `src/core/world/topic-state.ts` — `compileTopicState`

**Upstream conflicts:**
- All of the above except `pipeline.ts` are absent in upstream

**Modifications needed:**
- **CANNOT BE PORTED until `ops/kernel.ts` is ported** — this is a hard blocker
- Also needs `world/extractor.ts`, `world/topic-state.ts` ported or stubbed

---

## Stub Modules Needed

The following modules are referenced by intelligence files but do NOT exist in upstream v0.30.2 and must be either stubbed or ported:

| Stub Module | Purpose | Priority |
|-------------|---------|----------|
| `src/core/evidence/source-bridge.ts` | `webSourceItem()`, `sourceSpanForWebText()`, `parseSourceSpanRef()` — creates source item/span records for scout runner | HIGH |
| `src/core/claims/claim-ledger.ts` | `ClaimLedgerRecord`, `claimLedgerPath()` — used by radar.ts and data-hygiene.ts | HIGH |
| `src/core/world/extractor.ts` | `extractWorldCandidatesFromScout()`, `WorldExtractionReport` — used by topic-track-cycle.ts | HIGH |
| `src/core/world/topic-state.ts` | `compileTopicState()`, `TopicStateSurface`, `synthesisSurfacesPath()` — used by topic-track-cycle.ts and data-hygiene.ts | HIGH |
| `src/core/radar/surfacing.ts` | `surfacingCandidatesPath()`, `SurfacingCandidate` — used by data-hygiene.ts | MEDIUM |
| `src/core/actions/proposals.ts` | `actionProposalsPath()`, `ActionProposal` — used by data-hygiene.ts | MEDIUM |
| `src/core/memory/namespace-policy.ts` | `classifyNamespacePolicy()`, `validateNamespacePolicy()`, `GBrainNamespace`, `GBrainPrivacy`, `GBrainSensitivity` — used by scoutnet.ts and radar.ts | HIGH |
| `src/core/ops/kernel.ts` | `readOpsState()`, `upsertScoutSourceQueueItem()`, `OpsTopicTrack`, `OpsScoutSourceQueueItem`, etc. — 167KB, used by topic-track-cycle.ts | **BLOCKER** |

---

## Engine Interface Differences (v0.22.5 → v0.30.2)

| Interface | v0.22.5 | v0.30.2 | Action |
|-----------|---------|---------|--------|
| `EvidenceSignal` | Defined in `evidence-classify.ts` | Check if `src/core/answer/evidence-classify.ts` exists and has compatible interface | Audit interface compatibility |
| `AnswerShapeDef` | Defined in `synthesis-dsl.ts` | Check `src/core/answer/synthesis-dsl.ts` | Audit interface compatibility |
| BrainEngine | Standard v0.22.5 interface | Extended with `getRecentSalience()`, `find_anomalies` (v0.29) | Should be backward-compatible for non-salience ops |
| `SourceItemRecord`, `SourceSpanRecord` | Defined in `evidence/source-bridge.ts` | Not present in upstream | Must port or stub `source-bridge.ts` |
| Privacy tier strings | `P0_LOCAL_ONLY`, `P1_PRIVATE`, `P2_LIMITED_CLOUD`, `P3_PUBLIC` | Likely similar but verify | Check `engine.ts` and schema for privacy tier constants |

---

## Summary Table

| # | Source File | Target Path | Port Complexity | Blockers |
|---|-------------|-------------|-----------------|----------|
| 1 | `answer/signal-cluster.ts` | `answer/signal-cluster.ts` | MEDIUM | Interface audit for `EvidenceSignal`, `AnswerShapeDef` |
| 2 | `memory/scoutnet.ts` | `memory/scoutnet.ts` | MEDIUM | `namespace-policy.ts` must be ported/stubbed first |
| 3 | `memory/radar.ts` | `memory/radar.ts` | MEDIUM | `claims/claim-ledger.ts`, `scoutnet.ts` dependencies |
| 4 | `intelligence/policy.ts` | `intelligence/policy.ts` (NEW) | SIMPLE | Check for duplicate type definitions |
| 5 | `intelligence/eval-policy.ts` | `intelligence/eval-policy.ts` (NEW) | SIMPLE | Depends on #4 |
| 6 | `intelligence/data-hygiene.ts` | `intelligence/data-hygiene.ts` (NEW) | HARD | All intelligence store dependencies missing |
| 7 | `substrate-provider.ts` | — | N/A | File does not exist |
| 8 | `source-item-span-bridge.ts` | — | N/A | File does not exist |
| 9 | `scout/pipeline.ts` | `scout/pipeline.ts` (NEW) | HARD | `src/core/scout/` must be created; self-contained but `BUILTIN_SCOUT_RECIPES` domain-specific |
| 10 | `scout/runner.ts` | `scout/runner.ts` (NEW) | HARD | `evidence/source-bridge.ts` must be ported first |
| 11 | `scout/topic-track-cycle.ts` | `scout/topic-track-cycle.ts` (NEW) | HARD | **BLOCKED** by `ops/kernel.ts` — must port ops first |

---

## Recommendations

### Phase 1: Foundation Stubs (before any intelligence porting)
- Port `src/core/memory/namespace-policy.ts` (needed by scoutnet, radar)
- Port `src/core/evidence/source-bridge.ts` (needed by scout runner)
- Port `src/core/claims/claim-ledger.ts` (needed by radar)

### Phase 2: Core Scout System
- Port `src/core/scout/pipeline.ts` (self-contained, no deps)
- Port `src/core/scout/runner.ts` (depends on source-bridge)
- Port `src/core/memory/scoutnet.ts` (depends on namespace-policy)

### Phase 3: Radar + Intelligence Hygiene
- Port `src/core/memory/radar.ts` (depends on scoutnet, claim-ledger)
- Port `src/core/intelligence/policy.ts` (no deps)
- Port `src/core/intelligence/eval-policy.ts` (depends on policy)

### Phase 4: World + Actions (for data-hygiene)
- Port `src/core/world/extractor.ts`
- Port `src/core/world/topic-state.ts`
- Port `src/core/radar/surfacing.ts`
- Port `src/core/actions/proposals.ts`
- Port `src/core/intelligence/data-hygiene.ts`

### Phase 5: Ops-Dependent (Hard Blocker)
- **Port `src/core/ops/kernel.ts`** (167KB — major undertaking)
- Then port `src/core/scout/topic-track-cycle.ts`

### Alternative: If `ops/kernel.ts` is too large
Consider rewriting `topic-track-cycle.ts` to not depend on `ops/kernel.ts`, instead using a simplified in-memory store or the BrainEngine's built-in state management.

---

*Generated by INTELLIGENCE agent — scout pipeline + signal surfacing audit*