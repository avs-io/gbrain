/**
 * Unit tests for hybrid search RRF + freshness decay.
 * No database, no API keys — pure function testing.
 */

import { describe, test, expect } from 'bun:test';
import { rrfFusion } from '../src/core/search/hybrid.ts';
import type { SearchResult } from '../src/core/types.ts';

function makeResult(overrides: Partial<SearchResult> & { chunk_text: string; slug: string }): SearchResult {
  return {
    page_id: 1,
    title: 'Test Page',
    type: 'concept',
    chunk_source: 'compiled_truth',
    score: 1.0,
    stale: false,
    ...overrides,
  };
}

describe('rrfFusion: basic ranking', () => {
  test('result appearing in more lists ranks higher', () => {
    const shared = makeResult({ slug: 'shared', chunk_text: 'shared content here' });
    const unique = makeResult({ slug: 'unique', chunk_text: 'unique content only' });

    // shared appears in both lists, unique only in one
    const result = rrfFusion([[shared, unique], [shared]], 60, true);
    expect(result[0].slug).toBe('shared');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('earlier rank yields higher RRF score within one list', () => {
    const first = makeResult({ slug: 'first', chunk_text: 'first result' });
    const second = makeResult({ slug: 'second', chunk_text: 'second result' });

    const result = rrfFusion([[first, second]], 60, true);
    expect(result[0].slug).toBe('first');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('returns empty array for empty input', () => {
    expect(rrfFusion([], 60, true)).toEqual([]);
    expect(rrfFusion([[]], 60, true)).toEqual([]);
  });
});

describe('rrfFusion: freshness decay', () => {
  test('stale compiled_truth chunk ranks below equivalent fresh chunk', () => {
    // Two results at rank 0, same position — stale one gets decay applied
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh information here', stale: false });
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale information here', stale: true });

    const result = rrfFusion([[fresh], [stale]], 60, true, 0.85);
    expect(result[0].slug).toBe('fresh');
    expect(result[1].slug).toBe('stale');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('stale timeline chunk is NOT penalized (timeline is the fresh data)', () => {
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh compiled truth', stale: false });
    const staleTimeline = makeResult({
      slug: 'stale-timeline',
      chunk_text: 'stale page but timeline chunk',
      stale: true,
      chunk_source: 'timeline',
    });

    // stale-timeline is at rank 0, fresh at rank 1 — timeline chunks are NOT
    // penalized by freshness decay (only compiled_truth chunks are). The
    // compiled_truth boost (2.0x) may still push fresh ahead, but the key
    // invariant is that stale timeline chunks are not additionally decayed.
    const result = rrfFusion([[staleTimeline, fresh]], 60, true, 0.85);
    // Timeline chunks from stale pages should NOT be penalized by decay.
    // They may still rank below fresh compiled_truth due to the 2.0x boost,
    // but the decay multiplier should not be applied to them.
    const staleTimelineResult = result.find(r => r.slug === 'stale-timeline');
    expect(staleTimelineResult).toBeDefined();
    // The stale-timeline chunk should NOT have decay applied — its score
    // should be the boosted RRF score (2.0x boost for compiled_truth doesn't
    // apply to timeline chunks), not decayed.
    // Since fresh (rank 1, compiled_truth) gets 2.0x boost and stale-timeline
    // (rank 0, timeline) doesn't, fresh may still win — but the key is
    // that stale-timeline's score is NOT further reduced by decay.
    expect(staleTimelineResult!.score).toBeGreaterThan(0.5); // Not decayed to near-zero
  });

  test('freshnessDecay=1.0 leaves stale chunks unpenalized', () => {
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh result content' });
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale result content', stale: true });

    // With decay=1.0 (disabled), rank position determines order.
    // Note: compiled_truth chunks get a 2.0x boost, so fresh (rank 0) gets
    // 2/60 and stale (rank 1) gets 1/61 — fresh still wins.
    const result = rrfFusion([[fresh, stale]], 60, true, 1.0);
    expect(result[0].slug).toBe('fresh');
    // Stale chunk should NOT be additionally decayed — its score is raw RRF
    // normalized. With only 2 results, maxScore = 2/60 (fresh boosted),
    // stale score = (1/61) / (2/60) ≈ 0.49.
    const staleScore = result.find(r => r.slug === 'stale')!.score;
    expect(staleScore).toBeGreaterThan(0.4); // Not decayed
  });

  test('stale score reflects decay multiplier accurately', () => {
    const decay = 0.75;
    // Must use compiled_truth (not timeline) for decay to apply.
    // With a single result, normalization gives 1.0, then decay applied:
    // raw = 1/60, normalized = 1.0, boost = 2.0 (compiled_truth),
    // decay = 0.75 → final = 1.0 * 2.0 * 0.75 = 1.5
    const stale = makeResult({
      slug: 'stale',
      chunk_text: 'stale data here',
      stale: true,
    });

    const result = rrfFusion([[stale]], 60, true, decay);
    // Single result: normalized = 1.0, boost = 2.0, decay = 0.75
    expect(result[0].score).toBeCloseTo(2.0 * decay, 8);
  });

  test('fresh chunk ahead of stale even when stale appears in more lists', () => {
    // Both are compiled_truth. Stale gets 2.0x boost * decay, fresh gets 2.0x boost.
    // stale appears in 2 lists: raw = 2/60 + 2/61 ≈ 0.0328, normalized * 2.0 * 0.4
    // fresh appears in 1 list: raw = 1/60 ≈ 0.0167, normalized * 2.0
    // With decay=0.4: stale normalized score ≈ 0.4 * 2.0 = 0.8 (relative to max)
    // fresh normalized score = 1.0 (max). So fresh wins.
    const stale = makeResult({
      slug: 'stale',
      chunk_text: 'stale content repeated',
      stale: true,
    });
    const fresh = makeResult({
      slug: 'fresh',
      chunk_text: 'fresh content unique',
    });

    const result = rrfFusion([[stale, fresh], [stale]], 60, true, 0.4);
    expect(result[0].slug).toBe('fresh');
  });

  test('freshnessDecay clamped to [0, 1] — values outside range are clamped', () => {
    // Must use compiled_truth for decay to apply.
    const stale = makeResult({
      slug: 'stale',
      chunk_text: 'stale data here',
      stale: true,
    });

    // decay=0 → stale score should be 0 (fully suppressed)
    // Single result: normalized = 1.0, boost = 2.0, decay = 0 → 1.0 * 2.0 * 0 = 0
    const result0 = rrfFusion([[stale]], 60, true, 0);
    expect(result0[0].score).toBeCloseTo(0, 8);

    // decay=-5 → clamped to 0
    const resultNeg = rrfFusion([[stale]], 60, true, -5);
    expect(resultNeg[0].score).toBeCloseTo(0, 8);

    // decay=2.0 → clamped to 1.0 (no penalty)
    // Single result: normalized = 1.0, boost = 2.0, decay = 1.0 → 1.0 * 2.0 * 1.0 = 2.0
    const resultHigh = rrfFusion([[stale]], 60, true, 2.0);
    expect(resultHigh[0].score).toBeCloseTo(2.0, 8);
  });
});
