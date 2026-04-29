import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildClaimLedgerRecord,
  enqueueClaimLedgerRecord,
  evidenceRefFromSpan,
  hashQuote,
  validateClaimLedgerRecord,
} from '../src/core/claims/claim-ledger.ts';
import { hydrateEvidenceFromSpan } from '../src/commands/claim.ts';

const spanId = 'gbs1:default:sources/chatgpt/full-export-all/2025-12-24-analysis-of-project-options-690b6edf#compiled_truth:L12-L15';
const quote = 'Verdict emerged as a candidate name while discussing real options under uncertainty.';

function validRecord(overrides: Record<string, any> = {}) {
  return {
    ...buildClaimLedgerRecord({
      claim: 'Verdict was suggested during the World 8 / real-options-under-uncertainty discussion.',
      type: 'decision',
      confidence: 0.72,
      observedAt: '2025-12-24T00:00:00.000Z',
      evidence: [evidenceRefFromSpan(spanId, quote)],
      now: new Date('2026-04-29T07:00:00.000Z'),
    }),
    ...overrides,
  };
}

describe('claim ledger minimal', () => {
  test('valid review-only claim with exact span and quote hash passes', () => {
    expect(validateClaimLedgerRecord(validRecord())).toEqual([]);
  });

  test('claim proposals default to conservative namespace/privacy/sensitivity', () => {
    const record = validRecord();
    expect(record.namespace).toBe('personal');
    expect(record.privacy).toBe('private');
    expect(record.sensitivity).toBe('high');
    expect(validateClaimLedgerRecord(record)).toEqual([]);
  });

  test('claim validator enforces namespace policy values and unsafe combinations', () => {
    expect(validateClaimLedgerRecord(validRecord({ namespace: 'bad' }))).toContain('namespace must be one of: personal, ventures, world, network, scouts, actions, evals');
    expect(validateClaimLedgerRecord(validRecord({ namespace: 'world', privacy: 'public', sensitivity: 'high' }))).toContain('public privacy cannot be paired with high or restricted sensitivity');
  });

  test('trusted status is rejected for JSONL review-only layer', () => {
    expect(validateClaimLedgerRecord(validRecord({ status: 'trusted' }))).toContain(
      'JSONL claim ledger cannot mark claims trusted; trusted status requires reviewed DB/page integration in a later PR',
    );
  });

  test('evidence quote hash must match quote', () => {
    const record = validRecord({
      evidence: [{ ...evidenceRefFromSpan(spanId, quote), quote_hash: hashQuote('different quote') }],
    });
    expect(validateClaimLedgerRecord(record)).toContain('evidence[0].quote_hash must match quote');
  });

  test('span-derived metadata must match gbs1 span id', () => {
    const record = validRecord({
      evidence: [{ ...evidenceRefFromSpan(spanId, quote), start_line: 99 }],
    });
    expect(validateClaimLedgerRecord(record)).toContain('evidence[0].start_line must match span_id');
  });

  test('enqueue is append-only, dry-run by default, and duplicate-stable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-claims-'));
    const ledgerPath = join(dir, 'claim-ledger.jsonl');
    const record = validRecord();

    const dry = enqueueClaimLedgerRecord(record, { ledgerPath, dryRun: true });
    expect(dry.ok).toBe(true);
    expect(dry.queued).toBe(false);
    expect(existsSync(ledgerPath)).toBe(false);

    const first = enqueueClaimLedgerRecord(record, { ledgerPath });
    const second = enqueueClaimLedgerRecord(record, { ledgerPath });
    expect(first.ok).toBe(true);
    expect(first.queued).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(readFileSync(ledgerPath, 'utf-8').trim().split('\n')).toHaveLength(1);
  });

  test('CLI propose requires --yes to write review ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-claims-cli-'));
    const dry = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'claim', 'propose', '--from-span', spanId, '--claim', 'Verdict was suggested in the World 8 discussion.', '--quote', quote, '--type', 'decision', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: dir }, encoding: 'utf-8' },
    );
    expect(dry.status).toBe(0);
    const dryOut = JSON.parse(dry.stdout || '{}');
    expect(dryOut.ok).toBe(true);
    expect(dryOut.dryRun).toBe(true);
    expect(existsSync(join(dir, '.gbrain', 'claim-ledger.jsonl'))).toBe(false);

    const write = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'claim', 'propose', '--from-span', spanId, '--claim', 'Verdict was suggested in the World 8 discussion.', '--quote', quote, '--type', 'decision', '--namespace', 'world', '--privacy', 'internal', '--sensitivity', 'medium', '--yes', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: dir }, encoding: 'utf-8' },
    );
    expect(write.status).toBe(0);
    const out = JSON.parse(write.stdout || '{}');
    expect(out.ok).toBe(true);
    expect(out.queued).toBe(true);
    expect(out.record.namespace).toBe('world');
    expect(out.record.privacy).toBe('internal');
    expect(out.record.sensitivity).toBe('medium');
    expect(existsSync(join(dir, '.gbrain', 'claim-ledger.jsonl'))).toBe(true);
  });

  test('CLI propose rejects invalid namespace/privacy/sensitivity without writing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-claims-policy-cli-'));
    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'claim', 'propose', '--from-span', spanId, '--claim', 'Invalid public sensitive world claim.', '--quote', quote, '--namespace', 'world', '--privacy', 'public', '--sensitivity', 'high', '--yes', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: dir }, encoding: 'utf-8' },
    );
    expect(result.status).toBe(1);
    const out = JSON.parse(result.stdout || '{}');
    expect(out.ok).toBe(false);
    expect(out.errors).toContain('public privacy cannot be paired with high or restricted sensitivity');
    expect(existsSync(join(dir, '.gbrain', 'claim-ledger.jsonl'))).toBe(false);
  });

  test('propose can hydrate quote and quote hash from an exact source span', async () => {
    const exactSpan = 'gbs1:default:sources/test/pr3b#compiled_truth:L2-L3';
    const engine = {
      executeRaw: async () => [{
        slug: 'sources/test/pr3b',
        source_id: 'default',
        title: 'PR3B fixture',
        compiled_truth: 'Header\nThe claim quote begins here.\nThe claim quote ends here.\nFooter',
        timeline: '',
      }],
    };

    const evidence = await hydrateEvidenceFromSpan(engine as any, exactSpan);
    expect(evidence.quote).toBe('The claim quote begins here.\nThe claim quote ends here.');
    expect(evidence.quote_hash).toBe(hashQuote(evidence.quote));
    expect(evidence.start_line).toBe(2);

    const record = buildClaimLedgerRecord({
      claim: 'PR3B can hydrate quote hashes from exact source spans.',
      evidence: [evidence],
      now: new Date('2026-04-29T07:10:00.000Z'),
    });
    expect(validateClaimLedgerRecord(record)).toEqual([]);
  });

  test('span hydration abstains when requested lines cannot resolve exactly', async () => {
    const outOfRange = 'gbs1:default:sources/test/pr3b#compiled_truth:L2-L9';
    const engine = {
      executeRaw: async () => [{
        slug: 'sources/test/pr3b',
        source_id: 'default',
        compiled_truth: 'Only one line',
        timeline: '',
      }],
    };

    await expect(hydrateEvidenceFromSpan(engine as any, outOfRange)).rejects.toThrow('Could not resolve source span exactly');
  });

  test('span hydration rejects caller-provided hash mismatches', async () => {
    const exactSpan = 'gbs1:default:sources/test/pr3b#compiled_truth:L1-L1';
    const engine = {
      executeRaw: async () => [{
        slug: 'sources/test/pr3b',
        source_id: 'default',
        compiled_truth: 'Hash me exactly',
        timeline: '',
      }],
    };

    await expect(hydrateEvidenceFromSpan(engine as any, exactSpan, hashQuote('different'))).rejects.toThrow('Source span quote hash mismatch');
  });
});
