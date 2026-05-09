# Port Skills Status — gbrain → gbrain-sync

## Summary

Audited 21 custom skills from `~/.openclaw/workspace/gbrain/skills/`. All skills use standard gbrain CLI commands only — no custom `gbrain ops/radar/scout` commands, no imports from `src/core/ops/` or `src/core/intelligence/`. **No skills are blocked.**

---

## Skill Audit Table

| Skill | Upstream Exists? | Version Diff | Custom Deps | Port Complexity | Blocking? |
|-------|-----------------|--------------|-------------|-----------------|-----------|
| **brain-ops** | ✅ Yes | Same (v1.0.0) | None — uses standard gbrain search/query/put_page tools | None | No — identical |
| **briefing** | ✅ Yes | Same | None — uses standard gbrain query/get_page tools | None | No — identical |
| **signal-detector** | ✅ Yes | Same | None — uses standard gbrain put_page/search tools | None | No — identical |
| **daily-task-prep** | ✅ Yes | Same | None — uses standard gbrain query/get_page tools | None | No — identical |
| **enrich** | ✅ Yes | Same | None — uses standard gbrain get_page/put_page/search/timeline-add | None | No — identical |
| **cross-modal-review** | ✅ Yes | **Upstream newer (v1.1.0)** — has review-mode gating, Codex handoff, relationship to `gbrain eval cross-modal` | None — uses standard gbrain tools | Low | No — custom is older, upstream has superset |
| **data-research** | ✅ Yes | **Custom differs** — recipe system uses `~/.gbrain/recipes/` path; upstream has this too but custom may have custom recipes | None — parameterized by design | Low | No — recipe files copy separately |
| **idea-ingest** | ✅ Yes | **Differs** — custom has different output format, additional cross-linking phases | None | Medium | No — output format diff needs reconciliation |
| **meeting-ingestion** | ✅ Yes | **Differs** — custom has slightly different timeline-add syntax, Phase 5 timeline merge detail | None | Medium | No — functional equivalent in upstream |
| **citation-fixer** | ✅ Yes | **Upstream newer (v1.1.0)** — adds tweet reference resolution via X API (v0.25.1) | None | Low | No — custom is older subset |
| **repo-architecture** | ✅ Yes | Same | None — purely advisory, reads conventions | None | No — identical |
| **skill-creator** | ✅ Yes | **Upstream newer (v1.1.0)** — adds 11-item checklist, cross-modal eval gate, relationship to `/cross-modal-review` | None | Low | No — custom is older |
| **daily-task-manager** | ✅ Yes | **Upstream newer** — uses `gbrain get ops/tasks` and `gbrain put ops/tasks` (same pattern) | None | Low | No — functional equivalent |
| **cron-scheduler** | ✅ Yes | **Upstream newer** — references `skills/conventions/cron-via-minions.md` and v0.11.0 migration auto-rewrite | None | Low | No — custom is older |
| **reports** | ✅ Yes | **Upstream newer** — keyword routing to report categories | None | Low | No — custom is older subset |
| **testing** | ✅ Yes | **Upstream newer (v1.1.0)** — adds Mode 2: project test-suite health + regression intelligence | None | Low | No — custom is older |
| **soul-audit** | ✅ Yes | Same | None — generates identity files from user answers, uses put_page only | None | No — self-contained |
| **webhook-transforms** | ✅ Yes | **Upstream newer** — has dead-letter queue pattern, sanitization details | None | Low | No — custom is older |
| **minion-orchestrator** | ✅ Yes | **Upstream newer** — detailed shell job preconditions, PGLite --follow mode, MCP boundary docs | None | Low | No — custom is older |
| **skillpack-check** | ✅ Yes | **Upstream newer** — exit code 2 for determine failure, X API integration for tweet resolving | None | Low | No — custom is older |
| **smoke-test** | ✅ Yes | **Upstream newer** — 8 core tests including Codex Zod auto-fix, env var configuration | None | Low | No — custom is older |

---

## Detailed Findings

### ✅ Identical (no action needed)

These skills are byte-for-byte identical between source and target:
- `brain-ops`
- `briefing`
- `signal-detector`
- `daily-task-prep`
- `enrich`
- `repo-architecture`
- `soul-audit`

### 🔄 Upstream is newer (custom is older version)

These skills should be overwritten with the upstream version:
- `cross-modal-review` — upstream v1.1.0 with review-mode gating + Codex handoff
- `citation-fixer` — upstream v1.1.0 with tweet reference resolution
- `skill-creator` — upstream v1.1.0 with 11-item checklist
- `daily-task-manager` — upstream has same pattern, more detailed
- `cron-scheduler` — upstream has cron-via-minions.md conventions
- `reports` — upstream has keyword routing
- `testing` — upstream v1.1.0 with regression intelligence
- `webhook-transforms` — upstream has dead-letter queue + sanitization
- `minion-orchestrator` — upstream has shell job preconditions + PGLite mode
- `skillpack-check` — upstream has exit code 2 + X API integration
- `smoke-test` — upstream has 8 tests including Zod auto-fix

### ⚠️ Custom differs from upstream (needs reconciliation)

- **`idea-ingest`** — Custom has different output format and Phase 5 cross-linking detail. Upstream may have additional context that should be preserved.
- **`meeting-ingestion`** — Custom has Phase 5 timeline merge detail not in upstream. Functional equivalent exists but custom nuance may be worth preserving.

### 📋 Skills with custom content not in upstream

- **`data-research`** — Custom recipes at `~/.gbrain/recipes/` (investor-updates, expense-tracker, company-updates) are not skill files but recipe YAML configs. These need separate copying if user wants them.

---

## Custom Recipe Files (separate from skills)

Path: `~/.gbrain/recipes/`
- `investor-updates.yaml`
- `expense-tracker.yaml`
- `company-updates.yaml`

These are not skills but data pipeline recipes. Copy if the user wants the existing research pipelines.

---

## No Blocking Dependencies Found

**Checked for:**
- ❌ Custom gbrain CLI commands (`gbrain ops`, `gbrain radar`, `gbrain scout`) — **NOT FOUND**
- ❌ Imports from `src/core/ops/` or `src/core/intelligence/` — **NOT FOUND**
- ❌ Custom brain features requiring non-upstream schema — **NOT FOUND**

**All skills use only standard gbrain tools:**
- `search`, `query`, `get_page`, `put_page` — MCP brain tools
- `add_link`, `add_timeline_entry`, `get_backlinks` — graph tools
- `gbrain files upload-raw`, `gbrain sync`, `gbrain doctor` — CLI commands
- `gbrain jobs submit`, `gbrain agent run` — Minions orchestration

---

## Port Recommendations

### Priority 1: Overwrite with upstream (custom is older)
```bash
# These have newer versions in upstream — overwrite custom
cp ~/gbrain-sync/skills/cross-modal-review/SKILL.md ~/.openclaw/workspace/gbrain/skills/cross-modal-review/SKILL.md.bak
# ... etc for all 11 older skills
```

### Priority 2: Reconcile differing skills (idea-ingest, meeting-ingestion)
Review diffs and decide whether custom nuances should be preserved.

### Priority 3: Copy custom recipes (if desired)
```bash
cp -r ~/.gbrain/recipes/ ~/gbrain-sync/.gbrain/recipes/  # if exists
```

### Skills that are fully self-contained and ready:
All 21 skills are self-contained SKILL.md files with no external code dependencies. Port by copying the SKILL.md files (and reconciling version diffs as noted above).

---

## Conclusion

**No skills are blocked.** All 21 custom skills use only standard gbrain capabilities available in v0.30.2 (eonian/intelligence-ops). The primary work is:
1. 11 skills should be **overwritten** with newer upstream versions
2. 2 skills need **manual reconciliation** of output format differences
3. Recipe YAML files (if any) need **separate copying** from `~/.gbrain/recipes/`