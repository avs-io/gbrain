import { describe, expect, test } from 'bun:test';
import { validateSyntheticTrainingMix } from '../src/core/synthetic/validator.ts';

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    synthetic_type: 'qa_pair',
    seed_source_ids: [`src:${id}`],
    seed_evidence_span_ids: [`gbs1:default:sources/test/${id}#compiled_truth:L1-L2`],
    generated_by_model: 'fixture-local',
    generated_at: '2026-05-08T09:30:00.000Z',
    trust_scope: 'training_only',
    eligible_for_memory: false,
    ...overrides,
  };
}

describe('synthetic training mix guard', () => {
  test('accepts high-ratio real evidence seeded training records', () => {
    const report = validateSyntheticTrainingMix([
      record('a'),
      record('b'),
      record('c'),
      record('d'),
    ], { minRealSeedRatio: 0.75 });

    expect(report.ok).toBe(true);
    expect(report.real_seed_ratio).toBe(1);
    expect(report.synthetic_seeded_records).toBe(0);
    expect(report.recursive_synthetic_output_records).toBe(0);
  });

  test('rejects synthetic seeds, low real ratio, and recursive synthetic self-output', () => {
    const report = validateSyntheticTrainingMix([
      record('real'),
      record('syn-seed', { seed_source_ids: ['syn:prior-output'], seed_evidence_span_ids: ['gbs1:default:sources/test/syn#compiled_truth:L1-L2'] }),
      record('recursive', { lineage: { source: 'recursive_synthetic', parent: 'synthetic-output:123' } }),
    ], { minRealSeedRatio: 0.8 });

    expect(report.ok).toBe(false);
    expect(report.synthetic_seeded_records).toBe(1);
    expect(report.recursive_synthetic_output_records).toBe(1);
    expect(report.issues.map(i => i.path)).toContain('real_seed_ratio');
    expect(report.issues.map(i => i.path)).toContain('seed_source_ids');
    expect(report.issues.map(i => i.path)).toContain('lineage');
  });
});
