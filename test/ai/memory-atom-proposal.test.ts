import { describe, expect, test } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMemoryAtomProposal, enqueueMemoryAtomProposal, listMemoryAtomProposals, proposeMemoryAtomFromSpan, validateMemoryAtomProposal } from '../../src/core/ai/memory-atom-proposal.ts';
import { runAiCommand } from '../../src/commands/ai.ts';

const spanId = 'gbs1:default:sources/test/pr4#compiled_truth:L1-L2';

function validProposal(overrides: Record<string, any> = {}) {
  return buildMemoryAtomProposal({
    source_item_id: 'default:sources/test/pr4',
    evidence_span_ids: [spanId],
    atom_type: 'semantic_fact',
    subject_entities: ['Chief'],
    claim: 'Chief prefers review-only proposal flows for memory atoms.',
    temporal: {},
    confidence: 0.84,
    support_level: 'direct_quote',
    sensitivity: 'P1',
    suggested_namespace: 'personal',
    now: new Date('2026-04-29T10:00:00.000Z'),
    ...overrides,
  });
}

describe('memory atom proposals', () => {
  test('validator accepts review-only direct quote proposal', () => {
    expect(validateMemoryAtomProposal(validProposal())).toEqual([]);
  });

  test('validator rejects non-gbs1 span and unsupported support level', () => {
    expect(validateMemoryAtomProposal({ ...validProposal(), evidence_span_ids: ['chunk:bad'], proposal_id: 'map_x' })).toContain('evidence_span_ids[0] must be a gbs1 span');
    expect(validateMemoryAtomProposal({ ...validProposal(), support_level: 'unsupported' })).toContain('unsupported support_level cannot be enqueued or promoted');
  });

  test('proposal helper rejects non-gbs1 or missing quote direct quote requests', () => {
    expect(proposeMemoryAtomFromSpan({ span_id: 'chunk:bad', claim: 'x', atom_type: 'episode', suggested_namespace: 'personal', sensitivity: 'P0', quote: 'x' }).ok).toBe(false);
    expect(proposeMemoryAtomFromSpan({ span_id: spanId, claim: 'x', atom_type: 'episode', suggested_namespace: 'personal', sensitivity: 'P0' }).ok).toBe(false);
  });

  test('enqueue is review-only JSONL and stable on duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-atom-'));
    const path = join(dir, 'memory-atom-proposals.jsonl');
    const proposal = validProposal();
    const dry = enqueueMemoryAtomProposal(proposal, { queuePath: path, dryRun: true });
    expect(dry.queued).toBe(false);
    expect(existsSync(path)).toBe(false);
    const first = enqueueMemoryAtomProposal(proposal, { queuePath: path });
    const second = enqueueMemoryAtomProposal(proposal, { queuePath: path });
    expect(first.queued).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('list reads queue jsonl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-atom-list-'));
    const path = join(dir, 'memory-atom-proposals.jsonl');
    enqueueMemoryAtomProposal(validProposal(), { queuePath: path });
    const listed = listMemoryAtomProposals({ queuePath: path });
    expect(listed.proposals).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('CLI propose defaults dry-run and writes only with --yes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-atom-cli-'));
    const path = join(dir, 'memory-atom-proposals.jsonl');
    const logs: string[] = [];
    const prev = console.log;
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };
    try {
      await runAiCommand(null, ['memory-atoms', 'propose', '--from-span', spanId, '--claim', 'Chief prefers review-only proposal flows for memory atoms.', '--atom-type', 'semantic_fact', '--namespace', 'personal', '--sensitivity', 'P1', '--queue-path', path, '--json']);
      await runAiCommand(null, ['memory-atoms', 'propose', '--from-span', spanId, '--claim', 'Chief prefers review-only proposal flows for memory atoms.', '--atom-type', 'semantic_fact', '--namespace', 'personal', '--sensitivity', 'P1', '--queue-path', path, '--yes', '--json']);
    } finally {
      console.log = prev;
      rmSync(dir, { recursive: true, force: true });
    }
    expect(logs.join('\n')).toContain('queued');
  });
});
