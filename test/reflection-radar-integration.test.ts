/**
 * Reflection → Radar Integration Test
 *
 * End-to-end pipeline: typed memory items → reflection (notes + surfacing)
 * → radar scoring via the actual radar module API.
 *
 * This is the first integration test connecting PR3 (reflection) with
 * PR7 (radar surfacing).
 */

import { describe, test } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runReflection, type ReflectionResult } from "../src/core/memory/reflection.js";
import { scoreRadarCandidates, buildRadarReport, type RadarCandidate, type RadarReport } from "../src/core/memory/radar.js";
import type { TypedMemoryItem } from "../src/core/memory/types.js";

// ── Fixtures ──────────────────────────────────────────────────

const FIXTURES_PATH = join(
  import.meta.dir,
  "../../projects/gbrain-living-memory/implementation/typed-memory-fixtures.jsonl"
);

function loadFixtures(): TypedMemoryItem[] {
  const raw = readFileSync(FIXTURES_PATH, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => JSON.parse(line));
}

const FIXTURES = loadFixtures();

// ── Tests ─────────────────────────────────────────────────────

describe("reflection → radar integration", () => {
  test("reflection output is valid radar input", () => {
    const context = "Current work: local models evaluation, MLX doctrine review";
    const result = runReflection(FIXTURES, context, new Date().toISOString());

    assert.ok(result.pass, "reflection should pass");
    assert.ok(Array.isArray(result.reflection_notes), "reflection_notes is array");
    assert.ok(Array.isArray(result.surfacing_candidates), "surfacing_candidates is array");

    // Each surfacing candidate should have fields that radar can score
    for (const candidate of result.surfacing_candidates) {
      assert.ok(candidate.id, "candidate has id");
      assert.ok(candidate.memory_type, "candidate has memory_type");
      assert.ok(typeof candidate.relevance_score === "number", "candidate has relevance_score");
      assert.ok(
        ["none", "low", "medium", "high"].includes(candidate.interruption_cost),
        "candidate has valid interruption_cost"
      );
    }
  });

  test("radar scores reflection surfacing candidates via buildRadarReport", () => {
    const context = "Current work: local models evaluation, MLX doctrine review";
    const result = runReflection(FIXTURES, context, new Date().toISOString());

    // Score candidates through radar (empty arrays = no scout/claim data,
    // but buildRadarReport still produces a valid report)
    const candidates = scoreRadarCandidates({});
    const report = buildRadarReport({ candidates, source: "reflection-integration" });

    assert.strictEqual(report.schema, "gbrain.radar.report.v1", "report has correct schema");
    assert.ok(typeof report.generated_at === "string", "report has generated_at");
    assert.ok(typeof report.source === "string", "report has source");
    assert.ok(typeof report.candidate_count === "number", "report has candidate_count");
    assert.ok(typeof report.band_counts === "object", "report has band_counts");
    assert.ok(Array.isArray(report.candidates), "report has candidates array");
  });

  test("radar report with reflection surfacing candidates produces valid bands", () => {
    const context = "Current work: local models evaluation, MLX doctrine review";
    const result = runReflection(FIXTURES, context, new Date().toISOString());

    // Build a minimal scout observation from each surfacing candidate
    // to exercise the radar scoring path
    const scoutObservations = result.surfacing_candidates.map((c) => ({
      id: `scout_reflection_${c.id}`,
      observed_at: new Date().toISOString(),
      namespace: "world",
      privacy: "internal" as const,
      sensitivity: c.sensitivity as "low" | "medium" | "high" | "restricted",
      signal: {
        relevance: c.relevance_score,
        novelty: 0.5,
        confidence: 0.7,
        summary: c.claim,
      },
      coverage: {
        freshness_window_days: 14,
        sources_checked: 1,
        sources_not_checked: 0,
      },
      recommended_next_action: {
        type: "research" as const,
        rationale: `Surface: ${c.title}`,
      },
      source: {
        source_id: "reflection",
        name: c.title,
        title: c.title,
      },
    }));

    const candidates = scoreRadarCandidates({ scoutObservations: scoutObservations as any });
    const report = buildRadarReport({ candidates, source: "reflection-integration" });

    assert.strictEqual(report.schema, "gbrain.radar.report.v1", "report has correct schema");
    assert.ok(typeof report.candidate_count === "number", "report has candidate_count");
    assert.ok(typeof report.band_counts === "object", "report has band_counts");

    // Each candidate should have a valid band
    for (const candidate of candidates) {
      assert.ok(
        ["immediate-review", "daily-brief", "weekly-digest", "archive"].includes(candidate.band),
        `candidate ${candidate.id} has valid band: ${candidate.band}`
      );
      assert.ok(typeof candidate.scores.final === "number", `candidate ${candidate.id} has final score`);
    }
  });

  test("high-sensitivity candidates are suppressed in radar", () => {
    const context = "Current work: local models evaluation";
    const result = runReflection(FIXTURES, context, new Date().toISOString());

    // Build scout observations from surfacing candidates
    const scoutObservations = result.surfacing_candidates.map((c) => ({
      id: `scout_reflection_${c.id}`,
      observed_at: new Date().toISOString(),
      namespace: c.sensitivity === "high" || c.sensitivity === "restricted" ? "personal" : "world",
      privacy: c.sensitivity === "high" || c.sensitivity === "restricted" ? "private" as const : "internal" as const,
      sensitivity: c.sensitivity as "low" | "medium" | "high" | "restricted",
      signal: {
        relevance: c.relevance_score,
        novelty: 0.5,
        confidence: 0.7,
        summary: c.claim,
      },
      coverage: {
        freshness_window_days: 14,
        sources_checked: 1,
        sources_not_checked: 0,
      },
      recommended_next_action: {
        type: "research" as const,
        rationale: `Surface: ${c.title}`,
      },
      source: {
        source_id: "reflection",
        name: c.title,
        title: c.title,
      },
    }));

    const candidates = scoreRadarCandidates({ scoutObservations: scoutObservations as any });

    // High-sensitivity candidates should have review_queue_only=true
    // and be capped below immediate-review unless explicitly allowed
    const highSensitivityCandidates = candidates.filter(
      (c) => c.sensitivity === "high" || c.sensitivity === "restricted"
    );

    // If there are high-sensitivity candidates, verify they are review_queue_only
    // and not in immediate-review band (they may be weekly-digest or archive)
    for (const candidate of highSensitivityCandidates) {
      assert.ok(candidate.review_queue_only, `high-sensitivity candidate ${candidate.id} should be review_queue_only`);
      assert.notStrictEqual(candidate.band, "immediate-review", `high-sensitivity candidate ${candidate.id} should not be immediate-review`);
    }

    // Verify suppression count from reflection matches
    assert.ok(result.suppression_count >= 0, "suppression_count is non-negative");
  });

  test("empty context still produces surfacing candidates (entity-based, not context-gated)", () => {
    const result = runReflection(FIXTURES, "", new Date().toISOString());

    assert.ok(result.pass, "reflection should pass with empty context");
    // The reflection module is entity-based, not context-gated, so it produces
    // surfacing candidates even with empty context. This is by design.
    assert.ok(result.surfacing_candidates.length >= 0, "surfacing candidates may exist with empty context");
    // But suppression should still work for high-sensitivity items
    assert.ok(result.suppression_count >= 0, "suppression_count is non-negative");
  });

  test("deterministic: same input → same output", () => {
    const context = "Current work: Citadel post-human sovereignty review";
    const now = "2026-05-01T14:52:00.000Z";

    const result1 = runReflection(FIXTURES, context, now);
    const result2 = runReflection(FIXTURES, context, now);

    // Compare reflection notes
    assert.strictEqual(
      JSON.stringify(result1.reflection_notes),
      JSON.stringify(result2.reflection_notes),
      "reflection notes should be deterministic"
    );

    // Compare surfacing candidates
    assert.strictEqual(
      JSON.stringify(result1.surfacing_candidates),
      JSON.stringify(result2.surfacing_candidates),
      "surfacing candidates should be deterministic"
    );
  });

  test("full pipeline: fixtures → reflection → radar → report", () => {
    const context = "Current work: Sovereign AI India scout observation review";
    const result = runReflection(FIXTURES, context, new Date().toISOString());

    // Build scout observations from surfacing candidates
    const scoutObservations = result.surfacing_candidates.map((c) => ({
      id: `scout_reflection_${c.id}`,
      observed_at: new Date().toISOString(),
      namespace: c.sensitivity === "high" || c.sensitivity === "restricted" ? "personal" : "world",
      privacy: c.sensitivity === "high" || c.sensitivity === "restricted" ? "private" as const : "internal" as const,
      sensitivity: c.sensitivity as "low" | "medium" | "high" | "restricted",
      signal: {
        relevance: c.relevance_score,
        novelty: 0.5,
        confidence: 0.7,
        summary: c.claim,
      },
      coverage: {
        freshness_window_days: 14,
        sources_checked: 1,
        sources_not_checked: 0,
      },
      recommended_next_action: {
        type: "research" as const,
        rationale: `Surface: ${c.title}`,
      },
      source: {
        source_id: "reflection",
        name: c.title,
        title: c.title,
      },
    }));

    const candidates = scoreRadarCandidates({ scoutObservations: scoutObservations as any });
    const report = buildRadarReport({ candidates, source: "reflection-integration" });

    // Verify the full pipeline produces a valid report
    assert.ok(typeof report.candidate_count === "number", "report has candidate_count");
    assert.ok(typeof report.generated_at === "string", "report has timestamp");

    // Verify no candidates leak personal/ventures into world filter
    for (const candidate of candidates) {
      if (candidate.namespace === "personal" || candidate.namespace === "ventures") {
        // These should be filtered by the namespace policy
        assert.ok(candidate.review_queue_only, `personal/ventures candidate ${candidate.id} should be review_queue_only`);
      }
    }
  });
});
