import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  enqueueMemoryProposalPacket,
  exportMemoryProposalPackets,
  listMemoryProposalPackets,
  validateSurfacingProposalPacket,
} from '../src/commands/memory.ts';

const require = createRequire(import.meta.url);
const { generatePacket } = require('../../ops/gbrain-memory-engine/generate-surfacing-proposal-packet.js');

function validPacket(overrides: Record<string, any> = {}): any {
  const base = {
    generated_at: '2026-04-28T18:11:02.606Z',
    packet_type: 'governed_surfacing_proposal_packet',
    schema_version: 1,
    context: {
      kind: 'project_status_entry',
      path: 'projects/gbrain-living-memory/status/STATUS.md',
      hash: 'ctx_hash_123',
      excerpt: 'Current context mentions governed proposal packets.',
    },
    outcome: 'private_project_note',
    review_required: true,
    candidates: [
      {
        id: 'proc:gbrain:trusted-writeback-governance',
        proposed_action: 'private_project_note',
        memory_type: 'procedure_memory',
        sensitivity: 'medium',
        permission_scope: 'internal',
        surfacing_policy: 'on_context_match',
        claim: 'Durable trusted GBrain write-back should go through governed review.',
        source: {
          kind: 'workspace-project',
          path: 'gbrain/BOOTSTRAP.md',
          quote: 'Durable write-back goes only through gbrain propose-memory.',
        },
        review_requirements: ['Claw/Chief review required before trusted GBrain write-back.'],
        forbidden_actions: [
          'trusted_brain_direct_edit',
          'external_message_send',
          'auto_accept_high_sensitivity_memory',
        ],
      },
    ],
    guardrails: {
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      packet_is_review_only: true,
    },
    validation: { pass: true, errors: [] },
  };
  return { ...base, ...overrides };
}

describe('memory proposal packets', () => {
  test('valid packet passes validation', () => {
    expect(validateSurfacingProposalPacket(validPacket())).toEqual([]);
  });

  test('packet generator emits valid review-only no-op packets for unrelated context', () => {
    const packet = generatePacket({
      query: '',
      context: 'Casual lunch note: bananas, tea, and a quiet walk after work.',
      limit: 8,
    });

    expect(packet.outcome).toBe('no_op');
    expect(packet.review_required).toBe(false);
    expect(packet.candidates).toEqual([]);
    expect(packet.validation).toEqual({ pass: true, errors: [] });
    expect(packet.no_op_reason).toBeTruthy();
    expect(packet.guardrails.trusted_pages_edited).toBe(false);
    expect(packet.guardrails.external_messages_sent).toBe(false);
    expect(packet.guardrails.global_config_changed).toBe(false);
    expect(packet.guardrails.packet_is_review_only).toBe(true);
  });

  test('candidate missing provenance fails validation', () => {
    const packet = validPacket({
      candidates: [
        {
          id: 'bad-candidate',
          sensitivity: 'medium',
          forbidden_actions: ['trusted_brain_direct_edit', 'external_message_send'],
        },
      ],
    });
    expect(validateSurfacingProposalPacket(packet)).toContain('candidates[0].source.path is required');
    expect(validateSurfacingProposalPacket(packet)).toContain('candidates[0].source.quote is required');
  });

  test('candidate missing high-sensitivity auto-accept ban fails validation', () => {
    const packet = validPacket({
      candidates: [
        {
          id: 'high-risk-candidate',
          proposed_action: 'private_project_note',
          memory_type: 'relationship_memory',
          sensitivity: 'high',
          source: {
            path: 'memory/2026-04-28.md',
            quote: 'Sensitive relationship context requiring explicit review.',
          },
          forbidden_actions: ['trusted_brain_direct_edit', 'external_message_send'],
        },
      ],
    });

    expect(validateSurfacingProposalPacket(packet)).toContain(
      'candidates[0].forbidden_actions must include auto_accept_high_sensitivity_memory',
    );
  });

  test('candidate missing direct-edit or external-send bans fails validation', () => {
    const packet = validPacket({
      candidates: [
        {
          id: 'missing-forbidden-actions-candidate',
          proposed_action: 'private_project_note',
          memory_type: 'procedure_memory',
          sensitivity: 'medium',
          source: {
            path: 'memory/2026-04-28.md',
            quote: 'Review-only proposal candidate requiring explicit forbidden-action gates.',
          },
          forbidden_actions: ['auto_accept_high_sensitivity_memory'],
        },
      ],
    });

    const errors = validateSurfacingProposalPacket(packet);
    expect(errors).toContain('candidates[0].forbidden_actions must include trusted_brain_direct_edit');
    expect(errors).toContain('candidates[0].forbidden_actions must include external_message_send');
  });

  test('review-only guardrails reject global config changes and empty candidate batches', () => {
    const packet = validPacket({
      candidates: [],
      guardrails: {
        trusted_pages_edited: false,
        external_messages_sent: false,
        global_config_changed: true,
        packet_is_review_only: true,
      },
    });

    const errors = validateSurfacingProposalPacket(packet);
    expect(errors).toContain('guardrails.global_config_changed must be false');
    expect(errors).toContain('candidates must include at least one proposal candidate');
  });

  test('invalid packet writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const result = enqueueMemoryProposalPacket(validPacket({ validation: { pass: false, errors: ['bad'] } }), {
      queuePath,
    });
    expect(result.ok).toBe(false);
    expect(existsSync(queuePath)).toBe(false);
  });

  test('CLI enqueue --yes rejects non-review-only packet without queue write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-cli-'));
    const packetPath = join(dir, 'packet.json');
    const packet = validPacket({
      guardrails: {
        trusted_pages_edited: false,
        external_messages_sent: false,
        global_config_changed: false,
        packet_is_review_only: false,
      },
    });
    writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf-8');

    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'proposals', 'enqueue', '--packet', packetPath, '--yes', '--json'],
      {
        cwd: join(import.meta.dir, '..'),
        env: { ...process.env, HOME: dir },
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout || '{}');
    expect(output.ok).toBe(false);
    expect(output.errors).toContain('guardrails.packet_is_review_only must be true');
    expect(existsSync(join(dir, '.gbrain', 'memory-proposals.jsonl'))).toBe(false);
  });

  test('dry-run validates but does not write queue line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const result = enqueueMemoryProposalPacket(validPacket(), { queuePath, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(existsSync(queuePath)).toBe(false);
  });

  test('enqueue appends one review-only JSONL record and suppresses duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const packet = validPacket();
    const first = enqueueMemoryProposalPacket(packet, {
      queuePath,
      now: new Date('2026-04-28T19:09:00.000Z'),
    });
    const second = enqueueMemoryProposalPacket(packet, { queuePath });

    expect(first.ok).toBe(true);
    expect(first.queued).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    const lines = readFileSync(queuePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0]);
    expect(record.status).toBe('pending_review');
    expect(record.context_hash).toBe('ctx_hash_123');
    expect(record.guardrails.trusted_pages_edited).toBe(false);
    expect(record.guardrails.external_messages_sent).toBe(false);
    expect(record.guardrails.global_config_changed).toBe(false);
    expect(record.guardrails.packet_is_review_only).toBe(true);
  });

  test('duplicate suppression is stable across candidate order changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const firstPacket = validPacket({
      candidates: [
        validPacket().candidates[0],
        {
          ...validPacket().candidates[0],
          id: 'proc:gbrain:second-candidate',
          claim: 'Second candidate uses same context hash for order-stability coverage.',
        },
      ],
    });
    const reorderedPacket = validPacket({ candidates: [...firstPacket.candidates].reverse() });

    const first = enqueueMemoryProposalPacket(firstPacket, { queuePath });
    const second = enqueueMemoryProposalPacket(reorderedPacket, { queuePath });

    expect(first.queued).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(readFileSync(queuePath, 'utf-8').trim().split('\n').length).toBe(1);
  });

  test('list returns empty structured result when review queue is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'missing.jsonl');
    const result = listMemoryProposalPackets({ queuePath });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('list');
    expect(result.queueExists).toBe(false);
    expect(result.count).toBe(0);
    expect(result.proposals).toEqual([]);
  });

  test('list reads queued JSONL proposal records without DB access', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const packet = validPacket();
    const enqueue = enqueueMemoryProposalPacket(packet, {
      queuePath,
      now: new Date('2026-04-28T19:09:00.000Z'),
    });

    const result = listMemoryProposalPackets({ queuePath });

    expect(result.ok).toBe(true);
    expect(result.queueExists).toBe(true);
    expect(result.count).toBe(1);
    expect(result.proposals?.[0].id).toBe(enqueue.proposal?.id);
    expect(result.proposals?.[0].context_hash).toBe('ctx_hash_123');
  });

  test('list surfaces malformed queue lines as structured errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    writeFileSync(queuePath, '{bad json}\n', 'utf-8');

    const result = listMemoryProposalPackets({ queuePath });

    expect(result.ok).toBe(false);
    expect(result.queueExists).toBe(true);
    expect(result.count).toBe(0);
    expect(result.errors?.[0]).toStartWith('line 1:');
  });

  test('list fails closed on mixed valid and malformed queue lines while preserving parsed records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    const enqueue = enqueueMemoryProposalPacket(validPacket(), {
      queuePath,
      now: new Date('2026-04-28T19:09:00.000Z'),
    });
    writeFileSync(queuePath, `${readFileSync(queuePath, 'utf-8')}{bad json}\n`, 'utf-8');

    const listed = listMemoryProposalPackets({ queuePath });
    const exported = exportMemoryProposalPackets({ queuePath });

    expect(enqueue.queued).toBe(true);
    expect(listed.ok).toBe(false);
    expect(listed.queueExists).toBe(true);
    expect(listed.count).toBe(1);
    expect(listed.proposals?.[0].id).toBe(enqueue.proposal?.id);
    expect(listed.errors?.[0]).toStartWith('line 2:');
    expect(exported.ok).toBe(false);
    expect(exported.action).toBe('export');
    expect(exported.errors?.[0]).toStartWith('line 2:');
  });

  test('export renders a review-only markdown summary without trusted writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-proposals-'));
    const queuePath = join(dir, 'queue.jsonl');
    enqueueMemoryProposalPacket(validPacket(), {
      queuePath,
      now: new Date('2026-04-28T19:09:00.000Z'),
    });

    const result = exportMemoryProposalPackets({ queuePath });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('export');
    expect(result.format).toBe('markdown');
    expect(result.content).toContain('# GBrain memory proposals review export');
    expect(result.content).toContain('Review-only export. This command does not edit trusted brain pages or send external messages.');
    expect(result.content).toContain('proc:gbrain:trusted-writeback-governance');
    expect(result.content).toContain('source: BOOTSTRAP.md');
    expect(result.content).not.toContain('gbrain/BOOTSTRAP.md');
    expect(result.content).toContain('trusted_pages_edited=false');
    expect(result.content).toContain('external_messages_sent=false');
    expect(result.content).toContain('global_config_changed=false');
  });
});
