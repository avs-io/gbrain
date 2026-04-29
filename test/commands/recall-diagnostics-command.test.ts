import { describe, expect, test } from 'bun:test';
import { runAnswerCommand } from '../../src/commands/answer.ts';
import type { RecallResult } from '../../src/core/evidence/recall.ts';

const recall: RecallResult = {
  query: 'why did it change?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:a#L1-L2',
      source_id: 'a',
      slug: 'sources/a',
      section: 'compiled_truth',
      start_line: 1,
      end_line: 2,
      quote: 'The thing changed because it was too static.',
      quote_hash: '1'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.9,
    },
  ],
  warnings: [],
  integration: { search_source: 'direct' },
};

describe('answer diagnose-recall cli', () => {
  test('emits json diagnostics', async () => {
    const path = '/tmp/gbrain-recall-diagnostics.json';
    await Bun.write(path, JSON.stringify(recall));
    const out = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      const orig = console.log;
      console.log = (...args: any[]) => chunks.push(args.join(' '));
      runAnswerCommand(null, ['diagnose-recall', '--from-recall-json', path, '--json'])
        .then(() => { console.log = orig; resolve(chunks.join('\n')); })
        .catch(err => { console.log = orig; reject(err); });
    });

    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe('gbrain.recall_diagnostics.v1');
    expect(parsed.recommendation).toBe('good_for_synthesis');
  });

  test('diagnoses synthetic evidence instead of throwing before diagnostics', async () => {
    const path = '/tmp/gbrain-recall-diagnostics-syn.json';
    await Bun.write(path, JSON.stringify({ ...recall, evidence: [{ ...recall.evidence[0], span_id: 'syn:test' }] }));
    const out = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      const orig = console.log;
      const origExitCode = process.exitCode;
      process.exitCode = undefined;
      console.log = (...args: any[]) => chunks.push(args.join(' '));
      runAnswerCommand(null, ['diagnose-recall', '--from-recall-json', path, '--json'])
        .then(() => { console.log = orig; process.exitCode = origExitCode ?? 0; resolve(chunks.join('\n')); })
        .catch(err => { console.log = orig; process.exitCode = origExitCode ?? 0; reject(err); });
    });

    const parsed = JSON.parse(out);
    expect(parsed.recommendation).toBe('unsafe_for_synthesis');
    expect(parsed.warnings).toContain('contains_non_gbs1_evidence');
  });
});
