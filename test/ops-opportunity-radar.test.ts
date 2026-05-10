import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  buildOpportunityBriefReadySurface,
  parseOpportunityRadarInput,
  readOpportunityStore,
  recordOpportunityFeedback,
  runOpportunityRadar,
} from '../src/core/ops/opportunity-radar.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-ops-opportunity-')); }

function fixture() {
  return {
    chief_context: { active_projects: ['GBrain meeting intelligence', 'sovereign AI India'] },
    topic_states: [{
      schema: 'gbrain.synthesis_surface.topic_state.v1',
      topic: 'local-first agent memory',
      title: 'Local-first agent memory',
      recent_deltas: { new: [{ id: 'delta_local_memory', kind: 'new', summary: 'A public local-first agent memory framework launched evidence-addressed meeting briefs and agent handoffs for private teams.', observed_at: '2026-04-30T06:00:00.000Z', source_refs: [{ ref: 'srcspan1:web:memory:L1-L3', quote: 'local-first agent memory framework launched evidence-addressed meeting briefs' }] }], changed: [] },
    }],
    claim_records: [{ id: 'old_opp_meeting_intel', type: 'opportunity_memory', claim: 'Revisit GBrain meeting intelligence when local-first agent memory becomes practical.', namespace: 'ventures', observed_at: '2026-03-10T00:00:00.000Z', confidence: 0.76, evidence: [{ span_id: 'gbs1:notes:gbrain#opp:L1-L2', quote: 'Revisit meeting intelligence when local-first agent memory becomes practical.' }] }],
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

describe('Opportunity radar v1', () => {
  test('matches world deltas, old memory, and active projects into scored candidates', () => {
    const dir = tempDir();
    const storePath = join(dir, 'opportunities.jsonl');
    const parsed = parseOpportunityRadarInput(fixture());
    const report = runOpportunityRadar({ ...parsed, storePath, now: new Date('2026-04-30T08:00:00.000Z') });

    expect(report.schema).toBe('gbrain.ops.opportunity_radar.v1');
    expect(report.candidate_count).toBe(1);
    const candidate = report.candidates[0];
    expect(candidate.schema).toBe('gbrain.ops.opportunity_candidate.v1');
    expect(candidate.matched_memories[0].id).toBe('old_opp_meeting_intel');
    expect(candidate.matched_projects.some(p => /GBrain meeting intelligence/i.test(p.title))).toBe(true);
    expect(candidate.scores.final).toBeGreaterThan(0.55);
    expect(candidate.scores.relevance_to_active_bets).toBeGreaterThan(0);
    expect(candidate.scores.asymmetric_upside).toBeGreaterThan(0);
    expect(candidate.guardrails.trusted_personal_memory_mutated).toBe(false);
    expect(readFileSync(storePath, 'utf8')).toContain('gbrain.ops.opportunity_candidate.v1');
  });

  test('brief-ready surface includes top candidates and tracks useful/not useful feedback', () => {
    const dir = tempDir();
    const storePath = join(dir, 'opportunities.jsonl');
    const report = runOpportunityRadar({ ...parseOpportunityRadarInput(fixture()), storePath, now: new Date('2026-04-30T08:00:00.000Z') });
    const candidateId = report.candidates[0].id;

    let surface = buildOpportunityBriefReadySurface({ storePath, topN: 3, now: new Date('2026-04-30T09:00:00.000Z') });
    expect(surface.schema).toBe('gbrain.ops.opportunity_brief_ready.v1');
    expect(surface.top_candidates[0].id).toBe(candidateId);

    const useful = recordOpportunityFeedback({ candidateId, value: 'useful', reason: 'worth pursuing', storePath, now: new Date('2026-04-30T09:05:00.000Z') });
    expect(useful.false_positive).toBe(false);
    expect(readOpportunityStore(storePath).candidates.find(c => c.id === candidateId)?.status).toBe('useful');

    const notUseful = recordOpportunityFeedback({ candidateId, value: 'not_useful', reason: 'false positive: irrelevant match', storePath, now: new Date('2026-04-30T09:10:00.000Z') });
    expect(notUseful.false_positive).toBe(true);
    surface = buildOpportunityBriefReadySurface({ storePath, topN: 3 });
    expect(surface.false_positive_count).toBe(1);
    expect(surface.top_candidates.some(c => c.id === candidateId)).toBe(false);
  });

  test('ops CLI runs radar, emits brief-ready JSON, and records feedback', async () => {
    const dir = tempDir();
    const input = join(dir, 'signals.json');
    const store = join(dir, 'opportunities.jsonl');
    writeFileSync(input, JSON.stringify(fixture(), null, 2));

    const radar = JSON.parse(await capture(() => runOpsCommand(null, ['opportunities', 'radar', '--input', input, '--store', store, '--now', '2026-04-30T08:00:00.000Z', '--json'])));
    expect(radar.candidate_count).toBe(1);
    const id = radar.candidates[0].id;

    const brief = JSON.parse(await capture(() => runOpsCommand(null, ['opportunities', 'brief-ready', '--store', store, '--now', '2026-04-30T09:00:00.000Z', '--json'])));
    expect(brief.top_candidates[0].id).toBe(id);

    const feedback = JSON.parse(await capture(() => runOpsCommand(null, ['opportunities', 'feedback', id, '--not-useful', '--reason', 'noise / bad match', '--store', store, '--now', '2026-04-30T09:10:00.000Z', '--json'])));
    expect(feedback.feedback.value).toBe('not_useful');
    expect(feedback.feedback.false_positive).toBe(true);
  });
});
