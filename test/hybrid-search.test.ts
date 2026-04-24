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
    const result = rrfFusion([[shared, unique], [shared]]);
    expect(result[0].slug).toBe('shared');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('earlier rank yields higher RRF score within one list', () => {
    const first = makeResult({ slug: 'first', chunk_text: 'first result' });
    const second = makeResult({ slug: 'second', chunk_text: 'second result' });

    const result = rrfFusion([[first, second]]);
    expect(result[0].slug).toBe('first');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('returns empty array for empty input', () => {
    expect(rrfFusion([])).toEqual([]);
    expect(rrfFusion([[]])).toEqual([]);
  });
});

describe('rrfFusion: freshness decay', () => {
  test('stale compiled_truth chunk ranks below equivalent fresh chunk', () => {
    // Two results at rank 0, same position — stale one gets decay applied
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh information here', stale: false });
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale information here', stale: true });

    const result = rrfFusion([[fresh], [stale]], 0.85);
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

    // stale-timeline is at rank 0, fresh at rank 1 — without decay stale-timeline wins
    const result = rrfFusion([[staleTimeline, fresh]], 0.85);
    // timeline chunk from stale page should NOT be penalized
    expect(result[0].slug).toBe('stale-timeline');
  });

  test('freshnessDecay=1.0 leaves stale chunks unpenalized', () => {
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh result content' });
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale result content', stale: true });

    // With decay=1.0 (disabled), rank position determines order
    const result = rrfFusion([[fresh, stale]], 1.0);
    expect(result[0].slug).toBe('fresh');
    // Scores should be the same ratio as RRF formula (no multiplier applied)
    const freshScore = result.find(r => r.slug === 'fresh')!.score;
    const staleScore = result.find(r => r.slug === 'stale')!.score;
    // Both are penalized only by rank, not freshness — fresh is rank 0, stale is rank 1
    expect(freshScore).toBeCloseTo(1 / (60 + 0), 8);
    expect(staleScore).toBeCloseTo(1 / (60 + 1), 8);
  });

  test('stale score reflects decay multiplier accurately', () => {
    const decay = 0.75;
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale data here', stale: true });

    const result = rrfFusion([[stale]], decay);
    // rank 0 → RRF = 1/(60+0) = 1/60, then * 0.75
    const expected = (1 / 60) * decay;
    expect(result[0].score).toBeCloseTo(expected, 8);
  });

  test('fresh chunk ahead of stale even when stale appears in more lists', () => {
    // stale chunk appears in 2 lists, fresh in 1 — but decay should bring stale below fresh
    // We need strong enough decay: stale score = 2*(1/60)*decay vs fresh = 1/60
    // With decay=0.4: stale = 2/60*0.4 = 0.8/60 < 1/60 ✓
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale content repeated', stale: true });
    const fresh = makeResult({ slug: 'fresh', chunk_text: 'fresh content unique' });

    const result = rrfFusion([[stale, fresh], [stale]], 0.4);
    expect(result[0].slug).toBe('fresh');
  });

  test('freshnessDecay clamped to [0, 1] — values outside range are clamped', () => {
    const stale = makeResult({ slug: 'stale', chunk_text: 'stale data here', stale: true });

    // decay=0 → stale score should be 0 (fully suppressed)
    const result0 = rrfFusion([[stale]], 0);
    expect(result0[0].score).toBeCloseTo(0, 8);

    // decay=-5 → clamped to 0
    const resultNeg = rrfFusion([[stale]], -5);
    expect(resultNeg[0].score).toBeCloseTo(0, 8);

    // decay=2.0 → clamped to 1.0 (no penalty)
    const resultHigh = rrfFusion([[stale]], 2.0);
    expect(resultHigh[0].score).toBeCloseTo(1 / 60, 8);
  });
});
