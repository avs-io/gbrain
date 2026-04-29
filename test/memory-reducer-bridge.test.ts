import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildClaimLedgerRecord, enqueueClaimLedgerRecord, evidenceRefFromSpan } from '../src/core/claims/claim-ledger.ts';
import { reduceReviewJsonlToProposalPacket } from '../src/core/memory/reducer-bridge.ts';
import { validateSurfacingProposalPacket } from '../src/commands/memory.ts';

const spanId = 'gbs1:src_test_memory_reducer:sources/test/reducer-bridge.md#section:L1-L2';
const quote = 'Reducer bridge should preserve exact evidence and require review.';

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-reducer-bridge-'));
}

describe('native reducer bridge', () => {
  test('reduces review-only claim JSONL into a governed proposal packet without writing', () => {
    const dir = fixtureDir();
    const ledgerPath = join(dir, 'claim-ledger.jsonl');
    const record = buildClaimLedgerRecord({
      claim: 'Reducer bridge can lift exact-span claims into native proposal review.',
      type: 'procedure',
      namespace: 'evals',
      privacy: 'internal',
      sensitivity: 'medium',
      evidence: [evidenceRefFromSpan(spanId, quote)],
      now: new Date('2026-04-29T10:00:00.000Z'),
    });
    const enqueued = enqueueClaimLedgerRecord(record, { ledgerPath });
    expect(enqueued.ok).toBe(true);
    expect(existsSync(ledgerPath)).toBe(true);

    const result = reduceReviewJsonlToProposalPacket({ claimLedgerPath: ledgerPath, now: new Date('2026-04-29T10:05:00.000Z') });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.guardrails).toMatchObject({
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      database_written: false,
      packet_is_review_only: true,
    });
    expect(result.stats).toMatchObject({ claim_records_read: 1, memory_proposals_read: 0, candidate_count: 1 });
    expect(result.packet.packet_type).toBe('governed_surfacing_proposal_packet');
    expect(result.packet.review_required).toBe(true);
    expect(result.packet.candidates[0]).toMatchObject({
      claim: record.claim,
      proposed_action: 'review_for_native_memory_proposal',
      source: { span_id: spanId, quote, quote_hash: record.evidence[0].quote_hash },
    });
    expect(validateSurfacingProposalPacket(result.packet)).toEqual([]);
  });

  test('CLI reduce defaults to no queue write and can write only an explicit packet output', () => {
    const dir = fixtureDir();
    const ledgerPath = join(dir, 'claim-ledger.jsonl');
    const outPath = join(dir, 'packet.json');
    const queuePath = join(dir, 'memory-proposals.jsonl');
    const record = buildClaimLedgerRecord({
      claim: 'Reducer bridge CLI is dry-run by default.',
      type: 'procedure',
      namespace: 'evals',
      privacy: 'internal',
      sensitivity: 'medium',
      evidence: [evidenceRefFromSpan(spanId, quote)],
      now: new Date('2026-04-29T11:00:00.000Z'),
    });
    enqueueClaimLedgerRecord(record, { ledgerPath });

    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'proposals', 'reduce', '--claim-ledger', ledgerPath, '--memory-queue', queuePath, '--output', outPath, '--json'],
      { cwd: join(import.meta.dir, '..'), encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout || '{}');
    expect(output.ok).toBe(true);
    expect(output.action).toBe('reduce');
    expect(output.written).toBe(true);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(queuePath)).toBe(false);
    const packet = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(packet.guardrails.database_written).toBe(false);
    expect(packet.guardrails.trusted_pages_edited).toBe(false);
  });
});
