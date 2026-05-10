/**
 * PR7 — Noisy/False-Positive Surfacing Eval Harness
 *
 * Adversarial test cases that verify the radar surfacing system
 * correctly suppresses noisy, irrelevant, or overly aggressive
 * surfacing candidates.
 *
 * Exit criteria (per ROADMAP Iteration 3):
 * - Eval distinguishes useful surfacing from noise.
 * - Output is reviewable by Claw before any external/user interruption.
 * - Governed proposal packet can be generated without trusted-page edits.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateSurfacingCandidates,
  parseSurfacingFixture,
  readSurfacingStore,
  surfacingInputsFromSources,
  scoreSurfacingCandidate,
  type SurfacingCandidate,
} from '../src/core/radar/surfacing.ts';

// ── Helpers ──────────────────────────────────────────────────────

const baseNow = new Date('2026-05-02T05:00:00.000Z');

function makeFixture(overrides: Record<string, any> = {}): any {
  return { ...baseFixture(), ...overrides };
}

function baseFixture() {
  const ref = { source_span_id: 'srcspan1:web:frontier:L1-L3', source_item_id: 'src_frontier', quote: 'Local-first agent memory systems now ship evidence-addressed context packs.' };
  return {
    chief_context: { now: baseNow.toISOString(), active_projects: ['GBrain intelligence substrate'], interests: ['local-first agent memory'] },
    world_extraction: {
      schema: 'gbrain.world.extraction_report.v1', mode: 'candidate-review-only', trusted_world_truth: false, topic: 'agent memory', diagnostics: {},
      claims: [{ schema: 'gbrain.world.candidate_claim.v1', id: 'world_claim_1', topic: 'agent memory', text: 'Local-first agent memory systems now ship evidence-addressed context packs.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.82, observed_at: baseNow.toISOString(), source_refs: [ref] }],
      events: [], entity_updates: [],
    },
    bookmarks: [], claim_records: [], meetings: [],
  };
}

function countByStatus(candidates: SurfacingCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    counts[c.status] = (counts[c.status] || 0) + 1;
  }
  return counts;
}

function countBySourceKind(candidates: SurfacingCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    counts[c.source_kind] = (counts[c.source_kind] || 0) + 1;
  }
  return counts;
}

// ── Tests ────────────────────────────────────────────────────────

describe('PR7 — Noisy/False-Positive Surfacing Eval', () => {

  // ── Test 1: Pure spam bookmarks should be archived, not reviewed ──

  test('spammy crypto/AI bookmarks are archived, not surfaced to review', () => {
    const fixture = makeFixture({
      bookmarks: [
        { id: 'spam_1', title: '10x crypto AI viral trading secret', url: 'https://example.com/spam1', excerpt: 'A viral thread promises ultimate crypto AI riches without evidence.' },
        { id: 'spam_2', title: 'Get rich quick with AI agents', url: 'https://example.com/spam2', excerpt: 'This one trick will make you a million dollars using AI.' },
        { id: 'spam_3', title: 'Buy followers now — 1M for $5', url: 'https://example.com/spam3', excerpt: 'Instant social proof. No questions asked.' },
      ],
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const counts = countByStatus(candidates);
    // All spam bookmarks should be archived, not review/brief
    expect(counts['archived'] || 0).toBeGreaterThanOrEqual(3);
    expect(counts['review'] || 0).toBe(0);
    expect(counts['interrupt'] || 0).toBe(0);
  });

  // ── Test 2: High-sensitivity personal content should be suppressed ──

  test('high-sensitivity personal content is suppressed from surfacing', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [{
          schema: 'gbrain.world.candidate_claim.v1', id: 'personal_sensitive',
          topic: 'personal health', text: 'Chief is considering a major career change to focus on health.',
          type: 'personal_claim', status: 'candidate', support_status: 'supported',
          confidence: 0.9, observed_at: baseNow.toISOString(),
          source_refs: [{ source_span_id: 'gbs1:notes:health:L1-L5', source_item_id: 'notes:health', quote: 'Considering a career pivot to focus on health and wellbeing.' }],
          sensitivity: 'high',
          namespace: 'personal',
        }],
      },
    });

    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const sensitive = candidates.filter(c => c.source_id === 'personal_sensitive');
    expect(sensitive.length).toBeGreaterThan(0);
    // High-sensitivity personal content should NOT be review/interrupt
    const sensitiveStatus = sensitive[0].status;
    expect(['archived', 'cooldown', 'suppressed'].includes(sensitiveStatus)).toBe(true);
  });

  // ── Test 3: Duplicate rapid-fire signals should enter cooldown ──

  test('rapid-fire duplicate signals enter cooldown, not review', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'dup_1', topic: 'agent memory', text: 'Local-first agent memory systems ship.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.8, observed_at: new Date('2026-05-02T04:00:00.000Z').toISOString(), source_refs: [{ source_span_id: 'srcspan1:L1-L3', source_item_id: 'src1', quote: 'Local-first agent memory systems now ship.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'dup_2', topic: 'agent memory', text: 'Local-first agent memory systems are shipping now.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.78, observed_at: new Date('2026-05-02T04:30:00.000Z').toISOString(), source_refs: [{ source_span_id: 'srcspan2:L1-L3', source_item_id: 'src2', quote: 'Local-first agent memory systems are shipping now.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'dup_3', topic: 'agent memory', text: 'Agent memory systems ship local-first.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.75, observed_at: new Date('2026-05-02T04:45:00.000Z').toISOString(), source_refs: [{ source_span_id: 'srcspan3:L1-L3', source_item_id: 'src3', quote: 'Agent memory systems ship local-first.' }] },
        ],
      },
    });
    const parsed = parseSurfacingFixture(fixture);
    const first = generateSurfacingCandidates(parsed);
    // Second generation with existing candidates should put duplicates in cooldown
    const second = generateSurfacingCandidates({ ...parsed, now: new Date('2026-05-02T05:00:00.000Z'), existingCandidates: first });
    const dupes = second.filter(c => ['dup_1', 'dup_2', 'dup_3'].includes(c.source_id));
    const cooldownCount = dupes.filter(c => c.status === 'cooldown').length;
    expect(cooldownCount).toBeGreaterThanOrEqual(2);
    // At most 1 should be in review (the first unique signal)
    const reviewCount = dupes.filter(c => c.status === 'review').length;
    expect(reviewCount).toBeLessThanOrEqual(1);
  });

  // ── Test 4: Low-confidence signals on irrelevant topics should not reach review ──

  test('low-confidence signals on irrelevant topics are archived, not reviewed', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'low_conf_1', topic: 'cooking recipes', text: 'Maybe pasta recipes will become more popular.', type: 'world_claim', status: 'candidate', support_status: 'speculative', confidence: 0.15, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_low:L1-L1', source_item_id: 'src_low', quote: 'Maybe someday.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'low_conf_2', topic: 'sports scores', text: 'Perhaps local teams will improve.', type: 'world_claim', status: 'candidate', support_status: 'speculative', confidence: 0.1, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_low2:L1-L1', source_item_id: 'src_low2', quote: 'Perhaps.' }] },
        ],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const lowConf = candidates.filter(c => ['low_conf_1', 'low_conf_2'].includes(c.source_id));
    const reviewCount = lowConf.filter(c => c.status === 'review').length;
    expect(reviewCount).toBe(0);
    const archivedCount = lowConf.filter(c => c.status === 'archived').length;
    expect(archivedCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 5: Irrelevant topic signals should not surface ──

  test('signals on topics outside chief interests are archived', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'off_topic_1', topic: 'cooking recipes', text: 'Best pasta recipe for weeknight dinners.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.9, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_cook:L1-L5', source_item_id: 'src_cook', quote: 'Boil water, add pasta, drain, sauce.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'off_topic_2', topic: 'sports scores', text: 'Local team won 3-1 yesterday.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.85, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_sport:L1-L1', source_item_id: 'src_sport', quote: 'Final score: 3-1.' }] },
        ],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const offTopic = candidates.filter(c => ['off_topic_1', 'off_topic_2'].includes(c.source_id));
    const reviewCount = offTopic.filter(c => c.status === 'review').length;
    expect(reviewCount).toBe(0);
    const archivedCount = offTopic.filter(c => c.status === 'archived').length;
    expect(archivedCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 6: High-sensitivity world content with low personal fit ──

  test('high-sensitivity world content with low personal fit is suppressed', () => {
    const fixture = makeFixture({
      chief_context: { now: baseNow.toISOString(), active_projects: ['GBrain intelligence substrate'], interests: ['local-first agent memory'] },
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [{
          schema: 'gbrain.world.candidate_claim.v1', id: 'world_sensitive',
          topic: 'national security policy', text: 'New classified surveillance program expanded.',
          type: 'world_claim', status: 'candidate', support_status: 'confirmed',
          confidence: 0.95, observed_at: baseNow.toISOString(),
          source_refs: [{ source_span_id: 'srcspan_sec:L1-L10', source_item_id: 'src_sec', quote: 'Classified surveillance program expanded to new domains.' }],
          sensitivity: 'high',
        }],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const sensitive = candidates.find(c => c.source_id === 'world_sensitive');
    expect(sensitive).toBeDefined();
    // High-sensitivity content with no personal fit should be suppressed, not reviewed
    expect(['archived', 'suppressed', 'cooldown'].includes(sensitive!.status)).toBe(true);
  });

  // ── Test 7: Empty context should produce only low-score surfacing ──

  test('empty context produces only low-score surfacing, no review/interrupt', () => {
    const fixture = makeFixture({
      chief_context: { now: baseNow.toISOString(), active_projects: [], interests: [] },
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [{ schema: 'gbrain.world.candidate_claim.v1', id: 'empty_ctx_1', topic: 'agent memory', text: 'Local-first agent memory systems ship.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.8, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan:L1-L3', source_item_id: 'src', quote: 'Local-first agent memory systems now ship.' }] }],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    // Even with empty context, scout claims surface but with low personal_fit
    const emptyCtx = candidates.find(c => c.source_id === 'empty_ctx_1');
    expect(emptyCtx).toBeDefined();
    // Should NOT be review or interrupt (no personal context match)
    expect(['review'].includes(emptyCtx!.status)).toBe(false);
    // personal_fit should be low when no context matches (topic match alone gives ~0.35)
    expect(emptyCtx!.scores.personal_fit).toBeLessThan(0.5);
  });

  // ── Test 8: Nostalgic/obsolete signals should not surface ──

  test('obsolete/obsolete signals are archived, not reviewed', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'obsolete_1', topic: 'old technology', text: 'Flash storage is the future of computing.', type: 'world_claim', status: 'superseded', support_status: 'superseded', confidence: 0.3, observed_at: new Date('2020-01-01T00:00:00.000Z').toISOString(), source_refs: [{ source_span_id: 'srcspan_old:L1-L1', source_item_id: 'src_old', quote: 'Flash is the future.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'obsolete_2', topic: 'old technology', text: 'Social media is the primary communication channel.', type: 'world_claim', status: 'superseded', support_status: 'superseded', confidence: 0.2, observed_at: new Date('2019-06-01T00:00:00.000Z').toISOString(), source_refs: [{ source_span_id: 'srcspan_old2:L1-L1', source_item_id: 'src_old2', quote: 'Social media is everything.' }] },
        ],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const obsolete = candidates.filter(c => ['obsolete_1', 'obsolete_2'].includes(c.source_id));
    const reviewCount = obsolete.filter(c => c.status === 'review').length;
    expect(reviewCount).toBe(0);
    const archivedCount = obsolete.filter(c => c.status === 'archived').length;
    expect(archivedCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 9: Valid high-fit signal should still surface despite noise ──

  test('valid high-fit signal surfaces even when noise is present', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          // High-fit signal
          { schema: 'gbrain.world.candidate_claim.v1', id: 'valid_signal', topic: 'agent memory', text: 'Local-first agent memory systems now ship evidence-addressed context packs.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.85, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_valid:L1-L5', source_item_id: 'src_valid', quote: 'Local-first agent memory systems now ship evidence-addressed context packs.' }] },
          // Noise alongside
          { schema: 'gbrain.world.candidate_claim.v1', id: 'noise_1', topic: 'cooking', text: 'Best pasta recipe.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.9, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_cook:L1-L1', source_item_id: 'src_cook', quote: 'Boil water, add pasta.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'noise_2', topic: 'sports', text: 'Team won 3-1.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.85, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_sport:L1-L1', source_item_id: 'src_sport', quote: 'Final score: 3-1.' }] },
        ],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const valid = candidates.find(c => c.source_id === 'valid_signal');
    const noise = candidates.filter(c => ['noise_1', 'noise_2'].includes(c.source_id));
    // Valid signal should be in review (or at least not archived)
    expect(valid).toBeDefined();
    expect(['review', 'brief'].includes(valid!.status)).toBe(true);
    // Noise should be archived
    const noiseArchived = noise.filter(c => c.status === 'archived').length;
    expect(noiseArchived).toBe(noise.length);
  });

  // ── Test 10: Scoring discriminates useful vs noisy ──

  test('scoring correctly discriminates useful vs noisy signals', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'useful_1', topic: 'agent memory', text: 'Local-first agent memory systems ship.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.85, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_useful:L1-L3', source_item_id: 'src_useful', quote: 'Local-first agent memory systems now ship.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'noisy_1', topic: 'cooking', text: 'Best pasta recipe.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.9, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_cook:L1-L1', source_item_id: 'src_cook', quote: 'Boil water, add pasta.' }] },
        ],
      },
    });
    const parsed = parseSurfacingFixture(fixture);
    const inputs = surfacingInputsFromSources(parsed);
    const scores = inputs.map(input => ({
      source_id: input.source_id,
      score: scoreSurfacingCandidate(input, parsed.chiefContext, { now: baseNow }),
    }));
    const usefulScore = scores.find(s => s.source_id === 'useful_1')!.score;
    const noisyScore = scores.find(s => s.source_id === 'noisy_1')!.score;
    // Useful signal should score higher than noisy
    expect(usefulScore.final).toBeGreaterThan(noisyScore.final);
    // Useful should have higher personal_fit
    expect(usefulScore.personal_fit).toBeGreaterThan(noisyScore.personal_fit);
  });

  // ── Test 11: Interruption budget — only highest-signal interrupts ──

  test('interruption budget limits to highest-signal candidates only', () => {
    const fixture = makeFixture({
      world_extraction: {
        ...baseFixture().world_extraction,
        claims: [
          { schema: 'gbrain.world.candidate_claim.v1', id: 'int_1', topic: 'agent memory', text: 'Local-first agent memory systems ship.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.85, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_int1:L1-L3', source_item_id: 'src_int1', quote: 'Local-first agent memory systems now ship.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'int_2', topic: 'agent memory', text: 'Agent memory systems are shipping.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.7, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_int2:L1-L3', source_item_id: 'src_int2', quote: 'Agent memory systems are shipping.' }] },
          { schema: 'gbrain.world.candidate_claim.v1', id: 'int_3', topic: 'agent memory', text: 'Memory systems ship.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.6, observed_at: baseNow.toISOString(), source_refs: [{ source_span_id: 'srcspan_int3:L1-L3', source_item_id: 'src_int3', quote: 'Memory systems ship.' }] },
        ],
      },
    });
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    const interruptCount = candidates.filter(c => c.status === 'review').length;
    // At most 1-2 should interrupt (budget-limited)
    expect(interruptCount).toBeLessThanOrEqual(2);
    // The highest-scored one should be the one that interrupts
    const interruptCandidates = candidates.filter(c => c.status === 'review');
    if (interruptCandidates.length > 0) {
      const topScore = Math.max(...interruptCandidates.map(c => c.scores.final));
      const allScores = candidates.map(c => c.scores.final);
      expect(topScore).toBeGreaterThanOrEqual(Math.max(...allScores) - 0.15);
    }
  });

  // ── Test 12: Guardrails are always present ──

  test('all surfacing candidates include guardrails with review_only=true', () => {
    const fixture = makeFixture();
    const candidates = generateSurfacingCandidates(parseSurfacingFixture(fixture));
    for (const c of candidates) {
      expect(c.guardrails).toBeDefined();
      expect(c.guardrails.review_only).toBe(true);
      expect(c.guardrails.external_messages_sent).toBe(false);
      expect(c.guardrails.trusted_pages_edited).toBe(false);
    }
  });
});
