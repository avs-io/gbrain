import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { loadWorkflowEvalSuite, runWorkflowEval, validateWorkflowEvalSuite } from '../src/core/evals/workflow-suite.ts';

describe('workflow eval suite v1', () => {
  test('ships 50 balanced fixture-backed cases with PR26 metadata', () => {
    const suite = loadWorkflowEvalSuite();
    const violations = validateWorkflowEvalSuite(suite);
    const report = runWorkflowEval({}, suite);
    expect(violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.suite_total).toBe(50);
    expect(report.split_counts.visible).toBe(35);
    expect(report.split_counts.holdout).toBe(10);
    expect(report.split_counts.mutation).toBe(5);
    expect(Math.max(...Object.values(report.class_counts))).toBeLessThanOrEqual(12);
    expect(report.abstention_count).toBeGreaterThanOrEqual(10);
    expect(report.world_intelligence_count).toBeGreaterThanOrEqual(10);
    expect(report.context_pack_count).toBeGreaterThanOrEqual(8);
    expect(report.radar_count).toBeGreaterThanOrEqual(5);
  });

  test('privacy eval fails closed for P0/local-only and abstention fixtures', () => {
    const suite = loadWorkflowEvalSuite();
    const p0 = suite.cases.find(c => c.meta.privacyTier === 'P0_LOCAL_ONLY')!;
    p0.fixture.route = { providerKind: 'cloud', rawPrivateContext: true };
    const report = runWorkflowEval({ privacyOnly: true }, suite);
    expect(report.ok).toBe(false);
    expect(report.failures.some(f => f.reasons.some(r => r.includes('P0 case routed to cloud')))).toBe(true);
  });

  test('workflow eval scripts execute successfully', () => {
    for (const script of ['eval-recall.ts', 'eval-topic-tracks.ts', 'eval-context-packs.ts', 'eval-radar.ts', 'eval-privacy.ts']) {
      const result = spawnSync(process.execPath, ['run', `scripts/${script}`], { cwd: process.cwd(), encoding: 'utf8' });
      expect(result.status, `${script}\nstdout=${result.stdout}\nstderr=${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.schema).toBe('gbrain.workflow_eval_report.v1');
      expect(parsed.ok).toBe(true);
      expect(parsed.evaluated).toBeGreaterThan(0);
    }
  });
});
