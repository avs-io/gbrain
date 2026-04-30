import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { readActionProposalStore } from '../src/core/actions/proposals.ts';
import { readOpsState } from '../src/core/ops/kernel.ts';
import { deterministicLocalQwenTranscriptProvider, runMeetingTranscriptActions } from '../src/core/ops/meeting-transcript-actions.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-meeting-actions-')); }
function tempStore(dir = tempDir()): string { return join(dir, 'ops.jsonl'); }

function transcript(): string {
  return `# Meeting with Rahul\n\nAditya: I will prepare the integration deck by Friday.\nRahul: Please follow up with Priya about the integration checklist tomorrow.\nAditya: Remind me to revisit pricing next week.\nAditya: Remember that Rahul prefers concise WhatsApp updates before formal email.\n`;
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('meeting transcript action extraction v1', () => {
  test('routes private transcripts through local Qwen stub and creates commitments, follow-up proposals, reminders, and review-only memory proposals', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const archive = join(dir, 'meeting-actions.jsonl');
    const actionsStore = join(dir, 'action-proposals.jsonl');

    const report = runMeetingTranscriptActions({
      transcript: transcript(),
      transcriptRef: 'meeting:rahul-demo',
      storePath: store,
      archivePath: archive,
      actionProposalPath: actionsStore,
      now: new Date('2026-04-30T07:30:00.000Z'),
      provider: deterministicLocalQwenTranscriptProvider('P1_PRIVATE'),
    });

    expect(report.schema).toBe('gbrain.ops.meeting_transcript_actions.v1');
    expect(report.route).toMatchObject({ provider: 'local-qwen', local_only: true, cloud_allowed: false, deterministic_stub: true });
    expect(report.safety).toMatchObject({ local_private_processing: true, follow_up_drafts_require_approval: true, external_messages_sent: false, trusted_personal_memory_mutated: false, memory_output_review_only: true });
    expect(report.commitments).toHaveLength(1);
    expect(report.follow_ups).toHaveLength(1);
    expect(report.reminders).toHaveLength(1);
    expect(report.memory_proposals).toHaveLength(1);
    expect(report.memory_proposals[0]).toMatchObject({ review_only: true, trusted_personal_memory_mutated: false, suggested_namespace: 'personal' });

    expect(report.follow_up_action_proposals).toHaveLength(1);
    expect(report.follow_up_action_proposals[0]?.action_type).toBe('draft_email');
    expect(report.follow_up_action_proposals[0]?.approval.state).toBe('pending_approval');
    expect(report.follow_up_action_proposals[0]?.execution_policy.external_send_allowed).toBe(false);
    expect(report.follow_up_action_proposals[0]?.guardrails.external_messages_sent).toBe(false);

    expect(report.created_work_items).toHaveLength(3);
    expect(report.created_work_items.map(w => w.worker_kind).sort()).toEqual(['human_review', 'qwen_local', 'qwen_local']);
    expect(report.created_work_items.every(w => w.privacy_tier === 'P1_PRIVATE')).toBe(true);
    expect(report.created_work_items.every(w => Array.isArray(w.approval_gates) && w.approval_gates.includes('external_send'))).toBe(true);

    expect(existsSync(archive)).toBe(true);
    expect(JSON.parse(readFileSync(archive, 'utf8').trim()).transcript_ref).toBe('meeting:rahul-demo');

    const proposals = readActionProposalStore(actionsStore).proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.approval.state).toBe('pending_approval');

    const state = readOpsState(store);
    expect(state.work_items).toHaveLength(3);
    expect(state.work_items.map(w => w.state)).toEqual(['ready', 'ready', 'ready']);
    expect(state.work_items[0]?.source_refs[0]).toMatchObject({ kind: 'meeting_transcript', transcript_ref: 'meeting:rahul-demo' });
  });

  test('rejects non-local provider routes for private transcript extraction', () => {
    expect(() => runMeetingTranscriptActions({
      transcript: transcript(),
      transcriptRef: 'meeting:unsafe',
      storePath: tempStore(),
      provider: {
        route: { provider: 'local-qwen', model: 'bad', privacy_tier: 'P1_PRIVATE', local_only: false, cloud_allowed: true, deterministic_stub: true } as any,
        extract: () => ({ commitments: [], follow_ups: [], reminders: [], memory_proposals: [] }),
      },
    })).toThrow(/must route to local-qwen/);
  });

  test('ops CLI extracts a transcript file and writes report/action proposal stores', async () => {
    const dir = tempDir();
    const input = join(dir, 'transcript.md');
    const store = tempStore(dir);
    const actionsStore = join(dir, 'action-proposals.jsonl');
    const out = join(dir, 'report.json');
    writeFileSync(input, transcript());

    const output = JSON.parse(await capture(() => runOpsCommand(null, ['meetings', 'extract', '--input', input, '--store', store, '--actions-store', actionsStore, '--out', out, '--json'])));
    expect(output.route.provider).toBe('local-qwen');
    expect(output.follow_up_action_proposals).toHaveLength(1);
    expect(output.created_work_items).toHaveLength(3);
    expect(output.memory_proposals[0].review_only).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(readActionProposalStore(actionsStore).proposals).toHaveLength(1);
  });
});
