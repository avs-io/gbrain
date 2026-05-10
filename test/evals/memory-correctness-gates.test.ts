import { describe, expect, test } from 'bun:test';
import { evaluateMemoryCorrectnessGates, STRICT_MEMORY_CORRECTNESS_TARGETS } from '../../src/core/evals/memory-correctness-gates.ts';

describe('RDEP-45 strict memory correctness gates', () => {
  test('passes only with exact evidence, zero unsupported trusted claims, and 100% supporting citations', () => {
    const report = evaluateMemoryCorrectnessGates({ ...STRICT_MEMORY_CORRECTNESS_TARGETS });
    expect(report.pass).toBe(true);
    expect(report.failures).toEqual([]);
  });

  test('fails closed on unsupported trusted claim, citation imprecision, temporal miss, or weak partial abstain', () => {
    const report = evaluateMemoryCorrectnessGates({
      ...STRICT_MEMORY_CORRECTNESS_TARGETS,
      unsupported_trusted_claim_rate: 0.01,
      citation_precision: 0.99,
      temporal_correctness: 0.98,
      partial_abstain_accuracy: 0.95,
    });
    expect(report.pass).toBe(false);
    expect(report.failures.map(f => f.metric)).toEqual(expect.arrayContaining([
      'unsupported_trusted_claim_rate',
      'citation_precision',
      'temporal_correctness',
      'partial_abstain_accuracy',
    ]));
  });
});
