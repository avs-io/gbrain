import { describe, expect, it } from 'bun:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProposalForPromotion } from '../../src/core/ai/proposal-promotion-gate.ts';
import { runAiCommand } from '../../src/commands/ai.ts';

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposal_id: 'map_test',
    source_item_id: 'source:one',
    evidence_span_ids: ['gbs1:src:page#section:L1-L2'],
    atom_type: 'semantic_fact',
    subject_entities: ['Chief'],
    claim: 'Chief prefers review-only proposal flows for memory atoms.',
    temporal: {},
    confidence: 0.99,
    support_level: 'direct_quote',
    sensitivity: 'P1',
    suggested_namespace: 'personal',
    ...overrides,
  };
}

describe('proposal promotion gate', () => {
  it('promotes direct quote evidence', () => {
    const result = validateProposalForPromotion(proposal(), { getEvidenceSpans: () => [{ span_id: 'gbs1:src:page#section:L1-L2', quote: 'Chief prefers review-only proposal flows for memory atoms.' }] });
    expect(result.ok).toBe(true);
    expect(result.decision).toBe('promote');
  });

  it('rejects missing evidence', () => {
    const result = validateProposalForPromotion(proposal({ evidence_span_ids: [] }));
    expect(result.ok).toBe(false);
    expect(result.decision).toBe('reject');
    expect(result.reasons.join(' ')).toContain('evidence_spans are required');
  });

  it('rejects synthetic and non-gbs1 evidence', () => {
    const result = validateProposalForPromotion(proposal({ evidence_span_ids: ['syn:test', 'non-gbs1:test'] }));
    expect(result.ok).toBe(false);
    expect(result.decision).toBe('reject');
    expect(result.reasons.join(' ')).toContain('synthetic or non-gbs1 evidence is not promotable');
  });

  it('keeps strong inference as needs_review by default', () => {
    const result = validateProposalForPromotion(proposal({ support_level: 'strong_inference', claim: 'Chief prefers memory atom review-only flows.', evidence_span_ids: ['gbs1:src:page#section:L1-L2'] }), { getEvidenceSpans: () => [{ span_id: 'gbs1:src:page#section:L1-L2', quote: 'Chief prefers review-only proposal flows for memory atoms.', source_item_id: 'source:one' }], allowStrongInference: false });
    expect(result.decision).toBe('needs_review');
    expect(result.ok).toBe(false);
  });



  it('cli rejects proposal without exact evidence quotes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-promotion-gate-'));
    const file = join(dir, 'proposal.json');
    writeFileSync(file, JSON.stringify(proposal()), 'utf8');
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      await runAiCommand(null, ['memory-atoms', 'gate', '--proposal-json', file, '--json']);
    } finally { console.log = original; }
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.decision).toBe('reject');
    expect(parsed.reasons.join(' ')).toContain('exact evidence quotes are required');
  });

  it('supports cli gate json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-promotion-gate-'));
    const file = join(dir, 'proposal.json');
    writeFileSync(file, JSON.stringify(proposal({ evidence_spans: [{ span_id: 'gbs1:src:page#section:L1-L2', quote: 'Chief prefers review-only proposal flows for memory atoms.' }] })), 'utf8');
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      await runAiCommand(null, ['memory-atoms', 'gate', '--proposal-json', file, '--json']);
    } finally { console.log = original; }
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.schema).toBe('gbrain.ai.proposal-promotion-gate.v1');
    expect(parsed.decision).toBe('promote');
  });
});
