export type MemoryCorrectnessMetrics = {
  source_span_recall_at_10: number;
  exact_evidence_hit_rate: number;
  unsupported_trusted_claim_rate: number;
  citation_precision: number;
  temporal_correctness: number;
  contradiction_handling: number;
  partial_abstain_accuracy: number;
  supporting_citation_rate: number;
};

export type MemoryCorrectnessGateReport = {
  pass: boolean;
  targets: MemoryCorrectnessMetrics;
  observed: MemoryCorrectnessMetrics;
  failures: Array<{ metric: keyof MemoryCorrectnessMetrics; expected: number; observed: number }>;
};

export const STRICT_MEMORY_CORRECTNESS_TARGETS: MemoryCorrectnessMetrics = {
  source_span_recall_at_10: 1,
  exact_evidence_hit_rate: 1,
  unsupported_trusted_claim_rate: 0,
  citation_precision: 1,
  temporal_correctness: 1,
  contradiction_handling: 1,
  partial_abstain_accuracy: 1,
  supporting_citation_rate: 1,
};

const HIGHER_IS_BETTER: Array<keyof MemoryCorrectnessMetrics> = [
  'source_span_recall_at_10',
  'exact_evidence_hit_rate',
  'citation_precision',
  'temporal_correctness',
  'contradiction_handling',
  'partial_abstain_accuracy',
  'supporting_citation_rate',
];

export function evaluateMemoryCorrectnessGates(observed: MemoryCorrectnessMetrics, targets: MemoryCorrectnessMetrics = STRICT_MEMORY_CORRECTNESS_TARGETS): MemoryCorrectnessGateReport {
  const failures: MemoryCorrectnessGateReport['failures'] = [];
  for (const metric of Object.keys(targets) as Array<keyof MemoryCorrectnessMetrics>) {
    const expected = targets[metric];
    const actual = observed[metric];
    const ok = HIGHER_IS_BETTER.includes(metric) ? actual >= expected : actual <= expected;
    if (!ok) failures.push({ metric, expected, observed: actual });
  }
  return { pass: failures.length === 0, targets, observed, failures };
}
