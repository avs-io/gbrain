export type RecallPr2Case = {
  id: string;
  category: 'citadel' | 'verdict_world8' | 'sovereign_ai' | 'eonic' | 'people_open_loop' | 'preference' | 'opportunity' | 'negative_abstain' | 'genesis' | 'stale_current';
  query: string;
  expected_top1_source?: string;
  expected_top5_sources: string[];
  expected_quote_terms: string[];
  expected_genesis_source?: string;
  stale_source?: string;
  current_source?: string;
  expected_abstain: boolean;
  baseline_expected_failure: boolean;
};

export type RecallPr2Prediction = {
  case_id: string;
  top_sources: string[];
  quote_window?: string;
  abstained: boolean;
  genesis_source?: string;
  selected_current_source?: string;
};

export type RecallPr2Metrics = {
  total: number;
  top1_source_accuracy: number;
  top5_source_recall: number;
  quote_window_accuracy: number;
  genesis_accuracy: number;
  stale_current_accuracy: number;
  abstention_precision: number;
  baseline_failures_expected: number;
  baseline_failures_observed: number;
  pass: boolean;
  failures: string[];
};

function ratio(hit: number, total: number): number {
  return total === 0 ? 1 : Number((hit / total).toFixed(3));
}

function includesAllTerms(text: string | undefined, terms: string[]): boolean {
  const normalized = (text || '').toLowerCase();
  return terms.every(term => normalized.includes(term.toLowerCase()));
}

export function evaluateRecallPr2Benchmark(cases: RecallPr2Case[], predictions: RecallPr2Prediction[]): RecallPr2Metrics {
  const byCase = new Map(predictions.map(prediction => [prediction.case_id, prediction]));
  let top1Hit = 0;
  let top5Hit = 0;
  let quoteHit = 0;
  let quoteTotal = 0;
  let genesisHit = 0;
  let genesisTotal = 0;
  let staleHit = 0;
  let staleTotal = 0;
  let abstainCorrect = 0;
  let abstainTotal = 0;
  let baselineObserved = 0;
  const failures: string[] = [];

  for (const item of cases) {
    const prediction = byCase.get(item.id);
    if (!prediction) {
      failures.push(`${item.id}: missing prediction`);
      continue;
    }

    const shouldAbstain = item.expected_abstain;
    if (shouldAbstain) {
      abstainTotal += 1;
      if (prediction.abstained) abstainCorrect += 1;
      else failures.push(`${item.id}: expected abstain`);
      if (item.baseline_expected_failure && !prediction.abstained) baselineObserved += 1;
      continue;
    }

    if (item.expected_top1_source) {
      if (prediction.top_sources[0] === item.expected_top1_source) top1Hit += 1;
      else failures.push(`${item.id}: top1 source mismatch`);
    }
    if (prediction.top_sources.some(source => item.expected_top5_sources.includes(source))) top5Hit += 1;
    else failures.push(`${item.id}: top5 source miss`);

    if (item.expected_quote_terms.length > 0) {
      quoteTotal += 1;
      if (includesAllTerms(prediction.quote_window, item.expected_quote_terms)) quoteHit += 1;
      else failures.push(`${item.id}: quote-window terms missing`);
    }

    if (item.expected_genesis_source) {
      genesisTotal += 1;
      if (prediction.genesis_source === item.expected_genesis_source) genesisHit += 1;
      else failures.push(`${item.id}: genesis source mismatch`);
    }

    if (item.current_source) {
      staleTotal += 1;
      if (prediction.selected_current_source === item.current_source && prediction.top_sources[0] !== item.stale_source) staleHit += 1;
      else failures.push(`${item.id}: stale/current disambiguation failed`);
    }
  }

  const total = cases.length;
  const baselineExpected = cases.filter(item => item.baseline_expected_failure).length;
  const metrics: RecallPr2Metrics = {
    total,
    top1_source_accuracy: ratio(top1Hit, cases.filter(item => !item.expected_abstain && item.expected_top1_source).length),
    top5_source_recall: ratio(top5Hit, cases.filter(item => !item.expected_abstain).length),
    quote_window_accuracy: ratio(quoteHit, quoteTotal),
    genesis_accuracy: ratio(genesisHit, genesisTotal),
    stale_current_accuracy: ratio(staleHit, staleTotal),
    abstention_precision: ratio(abstainCorrect, abstainTotal),
    baseline_failures_expected: baselineExpected,
    baseline_failures_observed: baselineObserved,
    pass: false,
    failures,
  };
  metrics.pass = metrics.total > 0
    && metrics.top1_source_accuracy === 1
    && metrics.top5_source_recall === 1
    && metrics.quote_window_accuracy === 1
    && metrics.genesis_accuracy === 1
    && metrics.stale_current_accuracy === 1
    && metrics.abstention_precision === 1
    && metrics.baseline_failures_expected > 0;
  return metrics;
}
