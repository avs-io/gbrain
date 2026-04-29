import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendSyntheticJsonl, parseSyntheticJsonl, validateSyntheticQueryCase, validateSyntheticRecord, writeSyntheticJsonl } from '../src/core/synthetic/index.ts';

const validRecord = {
  id: 'synrec-1',
  synthetic_type: 'qa_pair' as const,
  seed_source_ids: ['src-1'],
  seed_evidence_span_ids: ['gbs1:span-1'],
  generated_by_model: 'local/qwen',
  generated_at: '2026-04-29T10:00:00Z',
  trust_scope: 'eval_only' as const,
  eligible_for_memory: false as const,
};

const validCase = {
  seed_evidence_span_ids: ['gbs1:span-1'],
  query: 'What happened?',
  query_shape: 'single_span_recall',
  expected_claim_ids: ['claim-1'],
  expected_abstain: false,
  hard_negative: false,
};

describe('synthetic validators', () => {
  test('accepts valid synthetic record', () => {
    expect(validateSyntheticRecord(validRecord)).toHaveLength(0);
  });
  test('rejects memory eligibility drift', () => {
    expect(validateSyntheticRecord({ ...validRecord, eligible_for_memory: true }).length).toBeGreaterThan(0);
  });
  test('accepts valid synthetic query case', () => {
    expect(validateSyntheticQueryCase(validCase)).toHaveLength(0);
  });
});

describe('synthetic JSONL helpers', () => {
  test('append/write/read round trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-synth-'));
    const path = join(dir, 'records.jsonl');
    writeSyntheticJsonl(path, [validRecord]);
    appendSyntheticJsonl(path, validRecord);
    const raw = readFileSync(path, 'utf8').trim().split('\n');
    expect(raw).toHaveLength(2);
    const parsed = parseSyntheticJsonl(raw.join('\n'), validateSyntheticRecord);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.errors).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
