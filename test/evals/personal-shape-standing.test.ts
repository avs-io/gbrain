import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateDecisionStyleCorpus, validatePersonalShapeStandingSet, type DecisionStyleCorpusCase, type PersonalShapeStandingCase } from '../../src/core/evals/personal-shape-standing.ts';

function readJsonl<T>(path: string): T[] {
  return readFileSync(new URL(path, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line) as T);
}

describe('RDEP-27/RDEP-46 grounded behavior/style eval corpora', () => {
  test('personal-shape standing set has 50 reviewed cases in each required category and all scoring dimensions', () => {
    const cases = readJsonl<PersonalShapeStandingCase>('../../data/evals/personal-shape-standing-v1.jsonl');
    const report = validatePersonalShapeStandingSet(cases, 50);
    expect(report.ok).toBe(true);
    expect(report.total).toBe(300);
    expect(Object.values(report.category_counts)).toEqual([50, 50, 50, 50, 50, 50]);
  });

  test('decision/style corpus is grounded, reviewed, and explicitly not trusted fact memory', () => {
    const cases = readJsonl<DecisionStyleCorpusCase>('../../data/evals/decision-style-grounded-corpus-v1.jsonl');
    const issues = validateDecisionStyleCorpus(cases);
    expect(issues).toEqual([]);
    expect(new Set(cases.map(item => item.output_kind))).toEqual(new Set(['decision_memo', 'opportunity_score', 'pushback', 'style_rendering']));
  });
});
