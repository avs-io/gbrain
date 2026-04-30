import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runActionsCommand } from '../src/commands/actions.ts';
import {
  ACTION_PROPOSAL_TYPES,
  actionProposalFromRadarCandidate,
  appendActionProposal,
  readActionProposalStore,
  validateActionProposal,
} from '../src/core/actions/proposals.ts';
import { appendSurfacingCandidates, generateSurfacingCandidates, parseSurfacingFixture } from '../src/core/radar/surfacing.ts';

const now = new Date('2026-04-30T05:00:00.000Z');

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

function fixture() {
  const ref = { source_span_id: 'srcspan1:web:frontier:L1-L3', source_item_id: 'src_frontier', quote: 'Local-first agent systems now use evidence-addressed action proposal gates before external actions.' };
  return {
    chief_context: { now: now.toISOString(), active_projects: ['GBrain intelligence substrate', 'OpenClaw agents'], interests: ['local-first agent memory'] },
    world_extraction: {
      schema: 'gbrain.world.extraction_report.v1', mode: 'candidate-review-only', trusted_world_truth: false, topic: 'agent memory', diagnostics: {},
      claims: [{ schema: 'gbrain.world.candidate_claim.v1', id: 'world_claim_action_gate', topic: 'agent memory', text: 'Local-first agent systems use governed proposal gates before external actions.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.88, observed_at: now.toISOString(), source_refs: [ref] }],
      events: [], entity_updates: [],
    },
    meetings: [{ id: 'cal_approval_lure', person: 'Founder', title: 'Schedule meeting request with Founder', starts_at: now.toISOString(), summary: 'Discuss OpenClaw agents and send a calendar invite only if approved.', evidence: [{ ref: 'calendar:cal_approval_lure', quote: 'send a calendar invite only if approved' }] }],
  };
}

describe('governed action proposals', () => {
  test('radar candidate becomes persisted candidate-only action proposal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-actions-'));
    const storePath = join(dir, 'action-proposals.jsonl');
    const radar = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now }).find(c => c.source_id === 'world_claim_action_gate')!;
    const proposal = actionProposalFromRadarCandidate(radar, { now });

    expect(proposal.proposal_type).toBe('action');
    expect(ACTION_PROPOSAL_TYPES).toContain(proposal.action_type);
    expect(proposal.evidence.length).toBeGreaterThan(0);
    expect(proposal.approval).toMatchObject({ state: 'pending_approval', gate: 'explicit_human_approval_required' });
    expect(proposal.execution_policy).toMatchObject({ candidate_only: true, external_send_allowed: false, external_schedule_allowed: false, trusted_memory_write_allowed: false, local_task_creation_allowed: false, execution_after_approval: 'record_intent_only' });
    expect(proposal.guardrails.actions_performed).toBe(false);
    expect(validateActionProposal(proposal)).toEqual([]);

    const appended = appendActionProposal(proposal, storePath);
    expect(appended.ok).toBe(true);
    expect(readActionProposalStore(storePath).proposals).toHaveLength(1);
  });

  test('CLI propose/review/approve records approval intent only and performs no action', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-actions-cli-'));
    const radarStore = join(dir, 'radar.jsonl');
    const actionStore = join(dir, 'actions.jsonl');
    const candidates = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now });
    appendSurfacingCandidates(candidates, radarStore);
    const radar = candidates.find(c => c.source_id === 'world_claim_action_gate')!;

    const proposed = JSON.parse(await capture(() => runActionsCommand(null, ['propose', '--from-radar', radar.id, '--radar-store', radarStore, '--store', actionStore, '--json'])));
    expect(proposed.ok).toBe(true);
    expect(proposed.proposal.source).toEqual({ kind: 'radar_candidate', id: radar.id });
    expect(proposed.guardrails.actions_performed).toBe(false);

    const reviewed = JSON.parse(await capture(() => runActionsCommand(null, ['review', '--store', actionStore, '--json'])));
    expect(reviewed.proposal_count).toBe(1);
    expect(reviewed.proposals[0].approval.state).toBe('pending_approval');

    const approved = JSON.parse(await capture(() => runActionsCommand(null, ['approve', proposed.proposal.id, '--store', actionStore, '--json'])));
    expect(approved.proposal.approval.state).toBe('approved');
    expect(approved.execution_policy.execution_after_approval).toBe('record_intent_only');
    expect(approved.guardrails.external_messages_sent).toBe(false);
    expect(approved.guardrails.calendar_events_created).toBe(false);
    expect(approved.guardrails.openclaw_tasks_created).toBe(false);
  });

  test('CLI reject requires reason and leaves proposal rejected without execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-actions-reject-'));
    const storePath = join(dir, 'actions.jsonl');
    const radar = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now }).find(c => c.source_id === 'world_claim_action_gate')!;
    const proposal = actionProposalFromRadarCandidate(radar, { now });
    appendActionProposal(proposal, storePath);

    const rejected = JSON.parse(await capture(() => runActionsCommand(null, ['reject', proposal.id, '--reason', 'not relevant now', '--store', storePath, '--json'])));
    expect(rejected.proposal.approval.state).toBe('rejected');
    expect(rejected.proposal.approval.rejection_reason).toBe('not relevant now');
    expect(rejected.guardrails.actions_performed).toBe(false);
  });

  test('approval-required external-action lure fails closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-actions-lure-'));
    const storePath = join(dir, 'actions.jsonl');
    const radar = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now }).find(c => c.source_kind === 'meeting_context')!;
    const proposal = actionProposalFromRadarCandidate(radar, { now });
    expect(proposal.action_type).toBe('schedule_meeting_request');
    expect(proposal.risk.external_effect).toBe(true);
    expect(proposal.execution_policy.external_schedule_allowed).toBe(false);
    expect(proposal.guardrails.calendar_events_created).toBe(false);

    appendActionProposal(proposal, storePath);
    const approved = JSON.parse(await capture(() => runActionsCommand(null, ['approve', proposal.id, '--store', storePath, '--json'])));
    expect(approved.proposal.approval.state).toBe('approved');
    expect(approved.proposal.execution_policy.execution_after_approval).toBe('record_intent_only');
    expect(approved.proposal.guardrails.calendar_events_created).toBe(false);
    expect(existsSync(join(dir, 'calendar-created.json'))).toBe(false);
  });

  test('validator rejects unsafe proposals that try to permit external sends or trusted writes', () => {
    const radar = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now }).find(c => c.source_id === 'world_claim_action_gate')!;
    const unsafe: any = actionProposalFromRadarCandidate(radar, { now });
    unsafe.action_type = 'send_email_now';
    unsafe.execution_policy.external_send_allowed = true;
    unsafe.execution_policy.trusted_memory_write_allowed = true;
    unsafe.guardrails.external_messages_sent = true;
    expect(validateActionProposal(unsafe)).toEqual(expect.arrayContaining([
      expect.stringContaining('action_type must be one of'),
      'execution_policy.external_send_allowed must be false',
      'execution_policy.trusted_memory_write_allowed must be false',
      'guardrails.external_messages_sent must be false',
    ]));
  });
});
