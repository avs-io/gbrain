import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { evaluateRecallPr2Benchmark, type RecallPr2Case, type RecallPr2Prediction } from '../../src/core/evals/recall-pr2-benchmark.ts';

function readJsonl<T>(path: string): T[] {
  return readFileSync(new URL(path, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line) as T);
}

const cases = readJsonl<RecallPr2Case>('../../data/evals/avs-recall-pr2-benchmark.jsonl');

function perfectPrediction(item: RecallPr2Case): RecallPr2Prediction {
  return {
    case_id: item.id,
    top_sources: item.expected_abstain ? [] : [item.expected_top1_source || item.expected_top5_sources[0], ...item.expected_top5_sources.slice(1)].filter(Boolean) as string[],
    quote_window: item.expected_quote_terms.join(' / '),
    abstained: item.expected_abstain,
    genesis_source: item.expected_genesis_source,
    selected_current_source: item.current_source,
  };
}

describe('ADOPT-11 PR2 recall benchmark harness', () => {
  test('tracks top1/top5 source, quote-window, genesis, stale-current, abstention and baseline failure protocol', () => {
    const metrics = evaluateRecallPr2Benchmark(cases, cases.map(perfectPrediction));
    expect(metrics.pass).toBe(true);
    expect(metrics.total).toBeGreaterThanOrEqual(10);
    expect(metrics.top1_source_accuracy).toBe(1);
    expect(metrics.top5_source_recall).toBe(1);
    expect(metrics.quote_window_accuracy).toBe(1);
    expect(metrics.genesis_accuracy).toBe(1);
    expect(metrics.stale_current_accuracy).toBe(1);
    expect(metrics.abstention_precision).toBe(1);
    expect(metrics.baseline_failures_expected).toBeGreaterThanOrEqual(3);
  });

  test('fails closed on old baseline style: no abstain and stale source selected', () => {
    const predictions = cases.map(item => ({
      case_id: item.id,
      top_sources: item.expected_abstain ? ['hallucinated-source'] : [item.stale_source || item.expected_top5_sources[0] || 'missing'],
      quote_window: '',
      abstained: false,
      genesis_source: undefined,
      selected_current_source: item.stale_source,
    }));
    const metrics = evaluateRecallPr2Benchmark(cases, predictions);
    expect(metrics.pass).toBe(false);
    expect(metrics.failures.length).toBeGreaterThan(0);
  });
});
