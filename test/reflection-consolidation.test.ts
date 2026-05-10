/**
 * Reflection / Consolidation Module Tests
 *
 * Tests for:
 * - Staleness detection (valid_time.end expired)
 * - Contradiction detection (same entity, conflicting validated claims)
 * - Opportunity matching (context matches opportunity_memory)
 * - Consolidation detection (entity groups > 2)
 * - Surfacing candidate gating (sensitivity/interruption cost)
 * - Suppression of high-sensitivity items
 * - Full pipeline (runReflection)
 */

import { describe, it, expect } from "bun:test";
import {
  runReflection,
  buildReflectionNotes,
  buildSurfacingCandidates,
  type ReflectionNote,
  type SurfacingCandidate,
  type ReflectionResult,
} from "../src/core/memory/reflection.ts";
import type { TypedMemoryItem } from "../src/core/memory/types.ts";

// ── Fixtures ──────────────────────────────────────────────────

function makeItem(overrides: Partial<TypedMemoryItem> = {}): TypedMemoryItem {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    memory_type: "semantic_fact",
    title: "Test Item",
    claim: "Default claim",
    source: { path: "/test/source.md" },
    confidence: 0.8,
    status: "validated",
    observed_at: "2026-04-01T00:00:00Z",
    sensitivity: "low",
    surfacing_policy: "on_query",
    entities: [],
    tags: [],
    ...overrides,
  };
}

const now = "2026-05-01T12:00:00Z";
const context = "Working on local models and MLX optimization for sovereign AI";

// ── Tests ─────────────────────────────────────────────────────

describe("Reflection / Consolidation Module", () => {
  describe("buildReflectionNotes", () => {
    it("detects stale items with expired valid_time.end", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "stale-1",
          title: "Old Strategy",
          claim: "Eonic was primary focus",
          valid_time: { end: "2026-03-01T00:00:00Z" },
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);

      expect(notes.length).toBeGreaterThan(0);
      const stale = notes.find((n) => n.kind === "stale");
      expect(stale).toBeDefined();
      expect(stale!.target_id).toBe("stale-1");
      expect(stale!.confidence).toBe(0.9);
    });

    it("detects contradictions between validated items with same entities", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "contradict-a",
          title: "Sovereign AI is primary",
          claim: "Sovereign AI is the primary institutional focus",
          entities: ["sovereign-ai", "institution"],
        }),
        makeItem({
          id: "contradict-b",
          title: "Citadel is primary",
          claim: "Citadel remains the primary content line",
          entities: ["citadel", "institution"],
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);

      const contradictions = notes.filter((n) => n.kind === "contradiction");
      expect(contradictions.length).toBeGreaterThan(0);
      // Either contradict-a or contradict-b can be first depending on iteration order
      expect(["contradict-a", "contradict-b"].includes(contradictions[0].target_id)).toBe(true);
      expect(contradictions[0].confidence).toBe(0.7);
    });

    it("does not flag contradictions when one item is not validated", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "validated-1",
          title: "Validated claim",
          claim: "This is validated",
          entities: ["entity-x"],
          status: "validated",
        }),
        makeItem({
          id: "draft-1",
          title: "Draft claim",
          claim: "This contradicts but is draft",
          entities: ["entity-x"],
          status: "draft",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const contradictions = notes.filter((n) => n.kind === "contradiction");
      expect(contradictions.length).toBe(0);
    });

    it("detects opportunity_memory matching context", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "opp-1",
          memory_type: "opportunity_memory",
          title: "MLX local model exploration",
          claim: "Explore MLX for local model optimization",
          tags: ["mlx", "local-models", "optimization"],
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);

      const opportunities = notes.filter((n) => n.kind === "opportunity");
      expect(opportunities.length).toBeGreaterThan(0);
      expect(opportunities[0].target_id).toBe("opp-1");
      expect(opportunities[0].confidence).toBeGreaterThan(0.2);
    });

    it("does not flag opportunity_memory when context does not match", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "opp-2",
          memory_type: "opportunity_memory",
          title: "Government GeM procurement exploration",
          claim: "Explore GeM procurement for Eonic",
          tags: ["government", "procurement"],
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const opportunities = notes.filter((n) => n.kind === "opportunity");
      expect(opportunities.length).toBe(0);
    });

    it("detects consolidation candidates (entity groups > 2)", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "consol-1",
          title: "Citadel origin",
          entities: ["citadel"],
        }),
        makeItem({
          id: "consol-2",
          title: "Citadel evolution",
          entities: ["citadel"],
        }),
        makeItem({
          id: "consol-3",
          title: "Citadel content line",
          entities: ["citadel"],
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);

      const consolidations = notes.filter((n) => n.kind === "consolidation");
      expect(consolidations.length).toBeGreaterThan(0);
      expect(consolidations[0].target_type).toBe("semantic_fact");
    });

    it("returns empty notes for unrelated items", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "unrelated-1",
          title: "Unrelated topic",
          claim: "Something about unrelated matter",
          status: "draft",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      expect(notes.length).toBe(0);
    });
  });

  describe("buildSurfacingCandidates", () => {
    it("surfaces low-sensitivity opportunity matches", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "surf-1",
          memory_type: "opportunity_memory",
          title: "MLX exploration",
          claim: "Explore MLX for local models",
          tags: ["mlx", "local-models"],
          sensitivity: "low",
          surfacing_policy: "on_query",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const candidates = buildSurfacingCandidates(items, context, notes, now);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].interruption_cost).toBe("low");
      expect(candidates[0].relevance_score).toBeGreaterThan(0);
    });

    it("suppresses high-sensitivity items without on_context_match policy", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "high-1",
          memory_type: "relationship_memory",
          title: "Sensitive government contact",
          claim: "Private meeting with e-Committee official",
          sensitivity: "high",
          surfacing_policy: "on_query",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const candidates = buildSurfacingCandidates(items, context, notes, now);

      // High sensitivity with on_query policy should be suppressed
      expect(candidates.length).toBe(0);
    });

    it("surfaces high-sensitivity items with on_context_match policy", () => {
      const matchingContext =
        "Planning sovereign AI outreach and government engagement with Somnath";
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "high-2",
          memory_type: "relationship_memory",
          title: "Government outreach",
          claim: "E-Committee outreach via Somnath",
          entities: ["somnath", "e-committee"],
          sensitivity: "high",
          surfacing_policy: "on_context_match",
        }),
      ];

      const notes = buildReflectionNotes(items, matchingContext, now);
      const candidates = buildSurfacingCandidates(items, matchingContext, notes, now);

      // on_context_match should allow surfacing
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].interruption_cost).toBe("high");
    });

    it("suppresses high-sensitivity items with approval_required policy", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "high-3",
          memory_type: "core_memory",
          title: "Sensitive policy",
          claim: "Internal policy decision",
          sensitivity: "high",
          surfacing_policy: "approval_required",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const candidates = buildSurfacingCandidates(items, context, notes, now);

      expect(candidates.length).toBe(0);
    });

    it("sorts candidates by relevance_score descending", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "low-rel",
          memory_type: "opportunity_memory",
          title: "Weak match",
          claim: "Vaguely related",
          tags: ["vague"],
          sensitivity: "low",
        }),
        makeItem({
          id: "high-rel",
          memory_type: "opportunity_memory",
          title: "MLX local model optimization",
          claim: "Direct MLX optimization work",
          tags: ["mlx", "local-models", "optimization"],
          sensitivity: "low",
        }),
      ];

      const notes = buildReflectionNotes(items, context, now);
      const candidates = buildSurfacingCandidates(items, context, notes, now);

      if (candidates.length >= 2) {
        expect(candidates[0].relevance_score).toBeGreaterThanOrEqual(
          candidates[1].relevance_score
        );
      }
    });
  });

  describe("runReflection (full pipeline)", () => {
    it("produces reflection notes and surfacing candidates from mixed items", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "stale-strategy",
          title: "Old strategy",
          claim: "Eonic was primary",
          valid_time: { end: "2026-02-01T00:00:00Z" },
          sensitivity: "low",
        }),
        makeItem({
          id: "mlx-opportunity",
          memory_type: "opportunity_memory",
          title: "MLX exploration",
          claim: "Explore MLX for local models",
          tags: ["mlx", "local-models"],
          sensitivity: "low",
        }),
        makeItem({
          id: "high-sensitive",
          memory_type: "relationship_memory",
          title: "Sensitive contact",
          claim: "Private government meeting",
          sensitivity: "high",
          surfacing_policy: "on_query",
        }),
      ];

      const result = runReflection(items, context, now);

      expect(result.pass).toBe(true);
      expect(result.reflection_notes.length).toBeGreaterThan(0);
      expect(result.surfacing_candidates.length).toBeGreaterThan(0);
      expect(result.suppression_count).toBeGreaterThan(0);

      // Should have stale + opportunity notes
      const kinds = result.reflection_notes.map((n) => n.kind);
      expect(kinds).toContain("stale");
      expect(kinds).toContain("opportunity");

      // High-sensitivity should be suppressed
      const suppressedIds = result.surfacing_candidates.map((c) => c.id);
      expect(suppressedIds).not.toContain("high-sensitive");
    });

    it("handles empty items array gracefully", () => {
      const result = runReflection([], context, now);

      expect(result.pass).toBe(true);
      expect(result.reflection_notes.length).toBe(0);
      expect(result.surfacing_candidates.length).toBe(0);
      expect(result.suppression_count).toBe(0);
    });

    it("handles items with no matching context", () => {
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "unrelated",
          title: "Unrelated topic",
          claim: "Something about unrelated matter",
          status: "draft",
        }),
      ];

      const result = runReflection(items, context, now);

      expect(result.pass).toBe(true);
      expect(result.reflection_notes.length).toBe(0);
      expect(result.surfacing_candidates.length).toBe(0);
    });

    it("includes context_summary truncated to 200 chars", () => {
      const longContext =
        "x".repeat(300) + " Working on local models and MLX optimization";
      const result = runReflection([], longContext, now);

      expect(result.context_summary.length).toBeLessThanOrEqual(203); // 200 + "…"
    });

    it("produces warnings when suppression occurs", () => {
      const matchingContext =
        "Reviewing sensitive government contacts and private meetings";
      const items: TypedMemoryItem[] = [
        makeItem({
          id: "suppressed",
          memory_type: "relationship_memory",
          title: "Sensitive government contact",
          claim: "Private meeting with e-Committee official",
          entities: ["e-committee"],
          sensitivity: "high",
          surfacing_policy: "on_query",
        }),
      ];

      const result = runReflection(items, matchingContext, now);

      // The note is produced (context matches), but the candidate is suppressed
      // because high-sensitivity + on_query = suppressed
      expect(result.reflection_notes.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("Suppressed");
    });
  });
});
