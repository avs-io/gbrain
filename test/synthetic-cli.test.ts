import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSyntheticCommand } from '../src/commands/synthetic.ts';
import { runAnswerCommand } from '../src/commands/answer.ts';

describe('synthetic CLI', () => {
  test('validate reports ok for valid record JSONL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-synth-cli-'));
    const path = join(dir, 'record.jsonl');
    writeFileSync(path, JSON.stringify({
      id: 'synrec-1', synthetic_type: 'qa_pair' as const, seed_source_ids: ['src-1'], seed_evidence_span_ids: ['gbs1:span-1'], generated_by_model: 'local/qwen', generated_at: '2026-04-29T10:00:00Z', trust_scope: 'eval_only' as const, eligible_for_memory: false as const,
    }) + '\n');
    const prev = console.log;
    const out: string[] = [];
    console.log = (...args: any[]) => { out.push(args.join(' ')); };
    try { await runSyntheticCommand(null, ['validate', path]); } finally { console.log = prev; rmSync(dir, { recursive: true, force: true }); }
    expect(out.join('\n')).toContain('"ok": true');
  });

  test('eval generate is deterministic and dry-run by default', async () => {
    const prev = console.log;
    const out: string[] = [];
    console.log = (...args: any[]) => { out.push(args.join(' ')); };
    try { await runSyntheticCommand(null, ['eval', 'generate', '--from-span', 'gbs1:span-1', '--json']); } finally { console.log = prev; }
    expect(out.join('\n')).toContain('dry_run');
    expect(out.join('\n')).toContain('gbs1:span-1');
  });
});

describe('synthetic evidence guard', () => {
  test('answer rejects synthetic evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-synth-answer-'));
    const path = join(dir, 'recall.json');
    writeFileSync(path, JSON.stringify({ query: 'x', evidence: [{ id: 'syn-span-1', span_id: 'syn:1', source_id: 'syn:src' }] }));
    const prevErr = console.error;
    console.error = () => {};
    try {
      await runAnswerCommand(null, ['--from-recall-json', path, '--json']);
      throw new Error('expected rejection');
    } catch (e) {
      expect(String(e)).toContain('Synthetic evidence');
    } finally { console.error = prevErr; rmSync(dir, { recursive: true, force: true }); }
  });
});
