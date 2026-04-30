import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildClaimLedgerRecord, evidenceRefFromSpan } from '../src/core/claims/claim-ledger.ts';
import { compileContextPackV2, validateContextPackV2 } from '../src/core/context/context-pack-v2.ts';
import type { TopicStateSurface } from '../src/core/world/topic-state.ts';

const now = new Date('2026-04-30T05:00:00.000Z');
const quote = 'GBrain PR23 needs a context pack compiler with cited source refs.';
const span = 'gbs1:default:sources/test/pr23#compiled_truth:L1-L3';

function record(overrides: Record<string, any> = {}) {
  return buildClaimLedgerRecord({
    claim: 'GBrain PR23 current project state is implementing ContextPack v2 compiler.',
    type: 'project_status',
    namespace: 'ventures',
    privacy: 'internal',
    sensitivity: 'medium',
    confidence: 0.82,
    observedAt: '2026-04-30T04:45:00.000Z',
    evidence: [evidenceRefFromSpan(span, quote)],
    now,
    ...overrides,
  });
}

function topicState(): TopicStateSurface {
  return {
    schema: 'gbrain.synthesis_surface.topic_state.v1',
    surface_type: 'topic_state',
    id: 'topic_state_pr23_agents',
    topic: 'agent-intelligence',
    title: 'Agent intelligence state',
    compiled_at: now.toISOString(),
    mode: 'review-only',
    trusted_world_truth: false,
    inputs: { extraction_reports: 1, candidate_claims: 1, verified_claims: 0, events: 0, entity_updates: 0 },
    current_state: [{ id: 'world_claim_1', kind: 'candidate', text: 'Agent context packs increasingly combine project state with external topic state.', status: 'candidate', support_status: 'supported', confidence: 0.7, observed_at: now.toISOString(), stale: false, source_refs: [{ source_span_id: 'srcspan1:public:agent#text:L1-L2', source_item_id: 'srcitem_agent', quote: 'context packs combine project state with external topic state', quote_hash: 'hash' }] }],
    recent_deltas: { since: now.toISOString(), new: [], changed: [], repeated: [] },
    entity_map: [],
    unresolved_questions: [],
    watchlist: [],
    relevance_to_active_projects: [{ project: 'GBrain PR23', relevance_score: 0.8, reasons: ['direct'], claim_ids: ['world_claim_1'], source_refs: [] }],
    diagnostics: { stale_claims: 0, uncited_rejected: 0, warnings: [] },
  };
}

describe('ContextPack v2 compiler surfaces', () => {
  test('project pack includes project memory plus external topic state when requested', () => {
    const pack = compileContextPackV2({ packType: 'project_pack', slug: 'GBrain PR23', includeWorld: true, records: [record()], topicStates: [topicState()], now });
    expect(pack.schema).toBe('gbrain.context_pack.v2');
    expect(pack.status).toBe('hit');
    expect(pack.sections.current_project_state[0].evidence_refs).toEqual([span]);
    expect(pack.sections.external_topic_state[0].evidence_refs).toEqual(['srcspan1:public:agent#text:L1-L2']);
    expect(pack.retrieval_sources.map(s => s.source_type)).toContain('project_memory');
    expect(pack.retrieval_sources.map(s => s.source_type)).toContain('world_topic_state');
    expect(pack.token_estimate).toBeGreaterThan(0);
    expect(pack.privacy_tier).toBe('P2_LIMITED_CLOUD');
    expect(validateContextPackV2(pack)).toEqual([]);
  });

  test('meeting brief uses network prior interactions and abstains when absent', () => {
    const relationship = record({ claim: 'Met Riya about the GBrain agent handoff plan.', type: 'relationship', namespace: 'network', privacy: 'private', sensitivity: 'medium' });
    const hit = compileContextPackV2({ packType: 'meeting_brief', person: 'Riya', records: [relationship], now });
    expect(hit.status).toBe('hit');
    expect(hit.sections.prior_interactions).toHaveLength(1);
    expect(hit.privacy_warnings.join('\n')).toContain('private context');

    const miss = compileContextPackV2({ packType: 'meeting_brief', person: 'No One', records: [relationship], now });
    expect(miss.status).toBe('abstain');
    expect(miss.unknowns.join('\n')).toContain('No prior interactions found');
  });

  test('opportunity eval varies retrieval across personal/project/world claims and warnings', () => {
    const pack = compileContextPackV2({ packType: 'opportunity_eval', opportunity: 'AI agent platform', records: [
      record({ claim: 'AI agent platform fits current GBrain project direction.', type: 'project_status', namespace: 'ventures' }),
      record({ claim: 'Chief prefers evidence-backed AI agent platform opportunities.', type: 'preference', namespace: 'personal', privacy: 'private' }),
      record({ claim: 'AI agent platform market signal is candidate-only and stale.', type: 'world_claim', namespace: 'world', privacy: 'public', status: 'stale' }),
    ], now });
    expect(pack.sections.personal_fit.length).toBeGreaterThan(0);
    expect(pack.sections.external_signals.length).toBeGreaterThan(0);
    expect(pack.stale_warnings.length).toBeGreaterThan(0);
    expect(pack.privacy_warnings.length).toBeGreaterThan(0);
  });

  test('agent handoff includes acceptance criteria and evidence refs', () => {
    const pack = compileContextPackV2({ packType: 'agent_handoff', taskId: 'PR23', task: { id: 'PR23', summary: 'Build ContextPack compiler', acceptance_criteria: ['Add project/meeting/opportunity/handoff compilers'], evidence_refs: [span] }, operationalNotes: [{ id: 'track', text: 'PR23 follows PR22 topic state compiler.', evidence_refs: ['ops:track:PR23'] }], now });
    expect(pack.status).toBe('hit');
    expect(pack.sections.acceptance_criteria[0].summary).toContain('project/meeting');
    expect(pack.sections.task[0].evidence_refs).toEqual([span]);
    expect(pack.retrieval_sources.map(s => s.source_type)).toContain('openclaw_operational_memory');
  });

  test('CLI exposes project, meeting, and agent-handoff JSON surfaces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-context-pr23-'));
    const claims = join(dir, 'claims.jsonl');
    const surfaces = join(dir, 'surfaces.jsonl');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(claims, JSON.stringify(record()) + '\n' + JSON.stringify(record({ claim: 'Met Riya about GBrain PR23.', type: 'relationship', namespace: 'network', privacy: 'private' })) + '\n');
    writeFileSync(surfaces, JSON.stringify(topicState()) + '\n');

    const base = { cwd: join(import.meta.dir, '..'), env: { ...process.env, HOME: home }, encoding: 'utf-8' as const };
    const project = spawnSync(process.execPath, ['run', 'src/cli.ts', 'context', 'project', '--slug', 'GBrain PR23', '--include-world', '--from-claims', claims, '--from-surfaces', surfaces, '--json'], base);
    expect(project.status).toBe(0);
    expect(JSON.parse(project.stdout).pack_type).toBe('project_pack');

    const meeting = spawnSync(process.execPath, ['run', 'src/cli.ts', 'context', 'meeting', '--person', 'Riya', '--date', 'today', '--from-claims', claims, '--json'], base);
    expect(meeting.status).toBe(0);
    expect(JSON.parse(meeting.stdout).pack_type).toBe('meeting_brief');

    const handoff = spawnSync(process.execPath, ['run', 'src/cli.ts', 'context', 'agent-handoff', '--task', 'PR23', '--acceptance', 'Add compiler;Add CLI', '--evidence-refs', span, '--json'], base);
    expect(handoff.status).toBe(0);
    expect(JSON.parse(handoff.stdout).sections.acceptance_criteria).toHaveLength(2);
  });
});
