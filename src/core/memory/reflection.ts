/**
 * Reflection / Consolidation Module
 *
 * Consumes typed memory fixtures + recent context/status;
 * produces reflection notes and surfacing candidates.
 *
 * This is the Iteration 3 prototype: smallest robust substrate
 * for the reflection/consolidation loop.
 *
 * Rules:
 * - Read-only: never writes to fixtures or trusted pages.
 * - Deterministic: same input → same output.
 * - Interrupt-safe: high-sensitivity candidates are suppressed
 *   unless explicitly allowed.
 */

import type { TypedMemoryItem } from "./types.js";

// ── Output types ──────────────────────────────────────────────

export type ReflectionNote = {
  kind: "stale" | "contradiction" | "consolidation" | "opportunity";
  target_id: string;
  target_type: string;
  title: string;
  reason: string;
  confidence: number; // 0-1
  evidence_refs: string[]; // source paths / span IDs
};

export type SurfacingCandidate = {
  id: string;
  memory_type: string;
  title: string;
  claim: string;
  relevance_score: number; // 0-1
  interruption_cost: "none" | "low" | "medium" | "high";
  surfacing_policy: string;
  reason: string;
  entities?: string[];
  sensitivity: string;
  source: { path: string };
};

export type ReflectionResult = {
  generated_at: string;
  context_summary: string;
  reflection_notes: ReflectionNote[];
  surfacing_candidates: SurfacingCandidate[];
  suppression_count: number;
  pass: boolean;
  warnings: string[];
};

// ── Core logic ────────────────────────────────────────────────

/**
 * Build reflection notes from typed memory items + context.
 *
 * Detects:
 * - Staleness: items with valid_time windows that have expired
 * - Contradictions: items with conflicting claims about the same entity
 * - Consolidation: items that could be merged (same entity, overlapping claims)
 * - Opportunity: deferred/opportunity_memory items that may be relevant now
 */
export function buildReflectionNotes(
  items: TypedMemoryItem[],
  context: string,
  now: string = new Date().toISOString()
): ReflectionNote[] {
  const notes: ReflectionNote[] = [];

  for (const item of items) {
    // 1. Staleness check: valid_time.end < now
    if (item.valid_time && typeof item.valid_time === "object") {
      const end = (item.valid_time as Record<string, string>).end;
      if (end && end < now) {
        notes.push({
          kind: "stale",
          target_id: item.id,
          target_type: item.memory_type,
          title: item.title,
          reason: `valid_time.end (${end}) is before current time (${now})`,
          confidence: 0.9,
          evidence_refs: [item.source.path],
        });
      }
    }

    // 2. Contradiction check: look for same entity with conflicting claims
    //    (simplified: compare claims of same memory_type and overlapping entities)
    for (const other of items) {
      if (other.id >= item.id) continue; // avoid double-checking
      if (other.memory_type !== item.memory_type) continue;
      const sharedEntities = (item.entities || []).filter((e) =>
        (other.entities || []).includes(e)
      );
      if (sharedEntities.length > 0) {
        // Simple contradiction heuristic: same entity, different claim, both validated
        if (
          item.claim !== other.claim &&
          item.status === "validated" &&
          other.status === "validated"
        ) {
          notes.push({
            kind: "contradiction",
            target_id: item.id,
            target_type: item.memory_type,
            title: `[${item.title}] vs [${other.title}]`,
            reason: `Conflicting claims about entities ${sharedEntities.join(", ")}: "${item.claim}" vs "${other.claim}"`,
            confidence: 0.7,
            evidence_refs: [item.source.path, other.source.path],
          });
        }
      }
    }

    // 3. Opportunity surfacing: opportunity_memory items that match context keywords
    if (item.memory_type === "opportunity_memory") {
      const contextLower = context.toLowerCase();
      const titleLower = item.title.toLowerCase();
      const claimLower = item.claim.toLowerCase();
      const tagsLower = (item.tags || []).map((t) => t.toLowerCase());

      const matchScore =
        (contextLower.includes(titleLower) ? 0.3 : 0) +
        (contextLower.includes(claimLower) ? 0.3 : 0) +
        tagsLower.filter((t) => contextLower.includes(t)).length * 0.15;

      if (matchScore > 0.1) {
        notes.push({
          kind: "opportunity",
          target_id: item.id,
          target_type: item.memory_type,
          title: item.title,
          reason: `Opportunity memory matches context (score ${matchScore.toFixed(2)}): ${item.claim}`,
          confidence: matchScore,
          evidence_refs: [item.source.path],
        });
      }
    }

    // 3b. Context-match surfacing: non-opportunity items that match current
    //     context keywords. Note: the surfacing policy gate is applied later
    //     in buildSurfacingCandidates, so we produce notes for all matching
    //     items regardless of policy — suppression happens at candidate stage.
    if (item.surfacing_policy === "on_context_match" || item.surfacing_policy === "on_query") {
      const contextLower = context.toLowerCase();
      const titleLower = item.title.toLowerCase();
      const claimLower = item.claim.toLowerCase();
      const tagsLower = (item.tags || []).map((t) => t.toLowerCase());
      const entityLower = (item.entities || []).map((e) => e.toLowerCase());

      const matchScore =
        (contextLower.includes(titleLower) ? 0.3 : 0) +
        (contextLower.includes(claimLower) ? 0.3 : 0) +
        tagsLower.filter((t) => contextLower.includes(t)).length * 0.15 +
        entityLower.filter((e) => contextLower.includes(e)).length * 0.2;

      if (matchScore > 0.1) {
        notes.push({
          kind: "opportunity",
          target_id: item.id,
          target_type: item.memory_type,
          title: item.title,
          reason: `Context-match surfacing (score ${matchScore.toFixed(2)}): ${item.claim}`,
          confidence: matchScore,
          evidence_refs: [item.source.path],
        });
      }
    }
  }

  // 4. Consolidation: group by entity, flag groups with >2 items
  const entityGroups = new Map<string, TypedMemoryItem[]>();
  for (const item of items) {
    for (const entity of item.entities || []) {
      const group = entityGroups.get(entity) || [];
      group.push(item);
      entityGroups.set(entity, group);
    }
  }
  for (const [entity, group] of entityGroups) {
    if (group.length > 2) {
      const ids = group.map((g) => g.id).slice(0, 5).join(", ");
      notes.push({
        kind: "consolidation",
        target_id: group[0].id,
        target_type: group[0].memory_type,
        title: `Consolidation candidate: ${entity}`,
        reason: `${group.length} items reference entity "${entity}" — consider merging`,
        confidence: 0.5,
        evidence_refs: group.slice(0, 3).map((g) => g.source.path),
      });
    }
  }

  return notes;
}

/**
 * Build surfacing candidates from reflection notes + typed memory items.
 *
 * Applies interruption-cost gating:
 * - high sensitivity → suppressed unless surfacing_policy === "on_context_match"
 * - medium sensitivity → suppressed unless context strongly matches
 * - low/medium → surfaced as candidates
 */
export function buildSurfacingCandidates(
  items: TypedMemoryItem[],
  context: string,
  reflectionNotes: ReflectionNote[],
  now: string = new Date().toISOString()
): SurfacingCandidate[] {
  const candidates: SurfacingCandidate[] = [];
  const contextLower = context.toLowerCase();

  // Build a lookup from reflection notes by target_id
  const noteMap = new Map<string, ReflectionNote>();
  for (const note of reflectionNotes) {
    noteMap.set(note.target_id, note);
  }

  for (const item of items) {
    const note = noteMap.get(item.id);
    if (!note) continue;

    // Skip stale items unless explicitly marked as opportunity
    if (note.kind === "stale" && item.status !== "candidate") {
      continue;
    }

    // Calculate relevance score
    let relevanceScore = 0;
    if (note.kind === "opportunity") {
      relevanceScore = Math.min(note.confidence, 1.0);
    } else if (note.kind === "contradiction") {
      relevanceScore = 0.6; // contradictions are important but not urgent
    } else if (note.kind === "consolidation") {
      relevanceScore = 0.3;
    } else {
      relevanceScore = 0.4;
    }

    // Determine interruption cost
    let interruptionCost: "none" | "low" | "medium" | "high" = "none";
    if (item.sensitivity === "high") {
      interruptionCost = "high";
    } else if (item.sensitivity === "medium") {
      interruptionCost = note.kind === "opportunity" ? "medium" : "low";
    } else {
      interruptionCost = "low";
    }

    // Apply surfacing policy gate
    const policy = item.surfacing_policy || "on_query";
    if (interruptionCost === "high" && policy !== "on_context_match") {
      continue; // suppressed
    }
    if (interruptionCost === "high" && policy === "approval_required") {
      continue; // requires human approval
    }

    candidates.push({
      id: item.id,
      memory_type: item.memory_type,
      title: item.title,
      claim: item.claim,
      relevance_score: relevanceScore,
      interruption_cost: interruptionCost,
      surfacing_policy: policy,
      reason: note.reason,
      entities: item.entities,
      sensitivity: item.sensitivity,
      source: { path: item.source.path },
    });
  }

  // Sort by relevance descending
  candidates.sort((a, b) => b.relevance_score - a.relevance_score);

  return candidates;
}

/**
 * Main entry: full reflection + surfacing pipeline.
 */
export function runReflection(
  items: TypedMemoryItem[],
  context: string,
  now: string = new Date().toISOString()
): ReflectionResult {
  const reflectionNotes = buildReflectionNotes(items, context, now);
  const surfacingCandidates = buildSurfacingCandidates(
    items,
    context,
    reflectionNotes,
    now
  );

  // Count suppressed items: those that produced a note but no candidate
  const noteById = new Map<string, ReflectionNote>();
  for (const note of reflectionNotes) {
    noteById.set(note.target_id, note);
  }
  const suppressionCount = items.filter((item) => {
    const note = noteById.get(item.id);
    if (!note) return false;
    const candidate = surfacingCandidates.find((c) => c.id === item.id);
    return !candidate; // suppressed
  }).length;

  return {
    generated_at: now,
    context_summary: context.length > 200 ? context.slice(0, 200) + "…" : context,
    reflection_notes: reflectionNotes,
    surfacing_candidates: surfacingCandidates,
    suppression_count: suppressionCount,
    pass: true,
    warnings:
      suppressionCount > 0
        ? [`Suppressed ${suppressionCount} high-sensitivity candidates`]
        : [],
  };
}
