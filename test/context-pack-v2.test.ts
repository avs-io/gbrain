import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildClaimLedgerRecord, evidenceRefFromSpan } from '../src/core/claims/claim-ledger.ts';
import { buildContextPackV2 } from '../src/core/memory/context-pack.ts';

const spanId = 'gbs1:default:sources/test/pr5#compiled_truth:L4-L6';
const quote = 'PR5 Context Pack v2 should assemble source-backed context with gbs1 spans.';
const now = new Date('2026-04-29T07:30:00.000Z');

function claim(overrides: Record<string, any> = {}) {
  return buildClaimLedgerRecord({
    claim: 'PR5 Context Pack v2 supports source-backed project decisions.',
    type: 'decision',
    namespace: 'world',
    privacy: 'internal',
    sensitivity: 'medium',
    confidence: 0.8,
    observedAt: '2026-04-29T07:00:00.000Z',
    evidence: [evidenceRefFromSpan(spanId, quote)],
    now,
    ...overrides,
  });
}

describe('context pack v2', () => {
  test('assembles decision/project context with gbs1 evidence index and policy metadata', () => {
    const pack = buildContextPackV2({
      mode: 'decision',
      topic: 'PR5 source backed decisions',
      records: [claim()],
      allowedNamespaces: ['world'],
      maxPrivacy: 'internal',
      maxSensitivity: 'medium',
      now,
    });

    expect(pack.schema).toBe('gbrain.context_pack.v2');
    expect(pack.status).toBe('hit');
    expect(pack.items).toHaveLength(1);
    expect(pack.items[0]).toMatchObject({ namespace: 'world', privacy: 'internal', sensitivity: 'medium', review_required: true });
    expect(pack.items[0].evidence_span_ids).toEqual([spanId]);
    expect(pack.evidence_index[0]).toMatchObject({ span_id: spanId, quote_hash: expect.any(String), quote });
    expect(pack.guardrails).toMatchObject({ read_only: true, trusted_pages_edited: false, external_messages_sent: false });
  });

  test('abstains when namespace/privacy/sensitivity policy excludes every matching record', () => {
    const pack = buildContextPackV2({
      mode: 'project',
      topic: 'private Chief decision',
      records: [claim({ namespace: 'personal', privacy: 'private', sensitivity: 'high', claim: 'Private Chief decision remains gated.' })],
      allowedNamespaces: ['world'],
      maxPrivacy: 'internal',
      maxSensitivity: 'medium',
      now,
    });

    expect(pack.status).toBe('abstain');
    expect(pack.items).toEqual([]);
    expect(pack.evidence_index).toEqual([]);
    expect(pack.excluded.policy).toBe(1);
    expect(pack.warnings.join('\n')).toContain('policy excluded all matching records');
  });

  test('emits stale and sensitive warnings for included private/high review records', () => {
    const pack = buildContextPackV2({
      mode: 'project',
      topic: 'Chief decision',
      records: [claim({ namespace: 'personal', privacy: 'private', sensitivity: 'high', status: 'stale', claim: 'Private Chief decision is stale.' })],
      allowedNamespaces: ['personal'],
      maxPrivacy: 'private',
      maxSensitivity: 'high',
      now,
    });

    expect(pack.status).toBe('hit');
    expect(pack.warnings.some(w => w.includes('private privacy'))).toBe(true);
    expect(pack.warnings.some(w => w.includes('high sensitivity'))).toBe(true);
    expect(pack.warnings.some(w => w.includes('stale/superseded'))).toBe(true);
  });

  test('CLI emits JSON context pack and redacts abstain as nonzero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-context-pack-v2-'));
    const home = join(dir, 'home');
    const ledger = join(home, '.gbrain', 'claim-ledger.jsonl');
    mkdirSync(join(home, '.gbrain'), { recursive: true });
    writeFileSync(ledger, JSON.stringify(claim()) + '\n', 'utf-8');

    const hit = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'context-pack', '--mode', 'decision', '--query', 'PR5 source backed', '--allowed-namespaces', 'world', '--max-privacy', 'internal', '--max-sensitivity', 'medium', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: home }, encoding: 'utf-8' },
    );
    expect(hit.status).toBe(0);
    const out = JSON.parse(hit.stdout || '{}');
    expect(out.ok).toBe(true);
    expect(out.action).toBe('context-pack');
    expect(out.evidence_index[0].span_id).toBe(spanId);

    const miss = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'context-pack', '--mode', 'decision', '--query', 'PR5 source backed', '--allowed-namespaces', 'personal', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: home }, encoding: 'utf-8' },
    );
    expect(miss.status).toBe(1);
    const missOut = JSON.parse(miss.stdout || '{}');
    expect(missOut.status).toBe('abstain');
  });
});
