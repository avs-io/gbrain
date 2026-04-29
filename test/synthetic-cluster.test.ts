import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateClusteredEvalCases } from '../src/core/synthetic/cluster-factory.ts';
import { runSyntheticCommand } from '../src/commands/synthetic.ts';

describe('clustered synthetic eval generation', () => {
  const spans = [
    { span_id: 'gbs1:span-a', quote: 'Alpha quote', source_item_id: 'src-a', topic: 'alpha', entities: ['Alpha'] },
    { span_id: 'gbs1:span-b', quote: 'Beta quote', source_item_id: 'src-b', topic: 'beta', entities: ['Beta'] },
  ];

  test('is deterministic', () => {
    const a = generateClusteredEvalCases({ spans, topic: 'alpha beta', shapes: ['exact_fact', 'timeline'], countPerShape: 2 });
    const b = generateClusteredEvalCases({ spans, topic: 'alpha beta', shapes: ['exact_fact', 'timeline'], countPerShape: 2 });
    expect(a).toEqual(b);
  });

  test('hard negatives abstain and remain eval-only', () => {
    const cases = generateClusteredEvalCases({ spans: [spans[0]], topic: 'alpha', shapes: ['why_not'], hardNegatives: true, countPerShape: 2 });
    expect(cases[1].expected_abstain).toBe(true);
    expect(cases[1].hard_negative).toBe(true);
    expect(cases[1].eligible_for_memory).toBe(false);
  });

  test('rejects non-gbs1 spans', () => {
    expect(() => generateClusteredEvalCases({ spans: [{ span_id: 'syn:1', quote: 'x' }], topic: 'x' })).toThrow(/synthetic spans are not allowed/i);
  });

  test('CLI writes JSONL only with --yes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-synth-cluster-'));
    const input = join(dir, 'spans.json');
    const out = join(dir, 'out.jsonl');
    writeFileSync(input, JSON.stringify(spans));
    const prev = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => logs.push(args.join(' '));
    try {
      await runSyntheticCommand(null, ['eval', 'generate-cluster', '--from-spans', input, '--topic', 'alpha beta', '--shape', 'exact_fact', '--out', out, '--json']);
      expect(() => readFileSync(out, 'utf8')).toThrow();
      await runSyntheticCommand(null, ['eval', 'generate-cluster', '--from-spans', input, '--topic', 'alpha beta', '--shape', 'exact_fact', '--out', out, '--yes', '--json']);
      expect(readFileSync(out, 'utf8')).toContain('synq_');
      expect(logs.join('\n')).toContain('dry_run');
    } finally {
      console.log = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
