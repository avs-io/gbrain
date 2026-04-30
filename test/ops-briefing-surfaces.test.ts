import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOpsCommand } from '../src/commands/ops.ts';
import { buildDailyBuildReportSurface, buildMorningBriefSurface, buildWeeklyStrategySynthesisSurface } from '../src/core/ops/briefing-surfaces.ts';
import { claimWorkItem, completeWorkItem, enqueueWorkPacket } from '../src/core/ops/kernel.ts';
import { parseOpportunityRadarInput, recordOpportunityFeedback, runOpportunityRadar } from '../src/core/ops/opportunity-radar.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-ops-briefs-')); }
function packet(...workItems: any[]) {
  return {
    programs: [{ id: 'always-on-os', title: 'Always-On Intelligence OS', objective: 'Continuously execute approved internal intelligence work.', priority: 100, autonomy: { internal_only: true } }],
    work_items: workItems,
  };
}
function work(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    program_id: 'always-on-os',
    title: `Implement ${id}`,
    description: `Do ${id}`,
    lane: 'code',
    worker_kind: 'subagent',
    privacy_tier: 'P1_PRIVATE',
    source_refs: [{ kind: 'spec', path: 'ops/specs/openclaw-always-on-intelligence-os-spec-2026-04-30.md' }],
    acceptance_criteria: ['targeted tests pass'],
    expected_artifacts: [{ kind: 'commit' }],
    guardrails: ['no external sends'],
    ...extra,
  };
}
function completion(id: string) {
  return { work_item_id: id, program_id: 'always-on-os', status: 'succeeded', summary: `${id} shipped with gates.`, artifacts: [{ kind: 'commit', ref: 'abc1234', summary: 'local commit' }], checks_run: ['bun test test/ops-briefing-surfaces.test.ts', 'bun run typecheck'], next_work_recommendations: [], requires_human: false, continuation: {} };
}
function signals() {
  return {
    chief_context: { active_projects: ['GBrain meeting intelligence'] },
    topic_states: [{ title: 'Agent memory', topic: 'agent-memory', recent_deltas: { new: [{ id: 'delta1', summary: 'A public local-first agent memory framework launched evidence-addressed meeting briefs for private teams.', observed_at: '2026-04-30T06:00:00.000Z', source_refs: [{ ref: 'srcspan1:web:agent-memory:L1-L2', quote: 'launched evidence-addressed meeting briefs' }] }], changed: [] } }],
    claim_records: [{ id: 'old1', type: 'opportunity_memory', claim: 'Revisit GBrain meeting intelligence when agent memory has evidence-addressed brief surfaces.', evidence: [{ span_id: 'gbs1:notes:gbrain:L1-L2', quote: 'Revisit GBrain meeting intelligence' }] }],
  };
}
async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

function seedStores(dir: string) {
  const opsStore = join(dir, 'ops.jsonl');
  const oppStore = join(dir, 'opportunities.jsonl');
  enqueueWorkPacket(packet(work('pr-a12'), work('pr-a13', { state: 'ready', priority: 90 }), work('pr-a14', { state: 'blocked', priority: 80 })), { path: opsStore, now: new Date('2026-04-30T07:00:00.000Z') });
  claimWorkItem('pr-a12', 'worker-a12', { path: opsStore, leaseMinutes: 30, provider: 'openclaw', model: 'subagent' });
  completeWorkItem('pr-a12', completion('pr-a12'), { path: opsStore, now: new Date('2026-04-30T08:00:00.000Z') });
  const report = runOpportunityRadar({ ...parseOpportunityRadarInput(signals()), storePath: oppStore, now: new Date('2026-04-30T08:15:00.000Z') });
  return { opsStore, oppStore, candidateId: report.candidates[0].id };
}

describe('ops daily and weekly briefing surfaces', () => {
  test('morning brief reads structured ops/opportunity stores and stays brief-ready only', () => {
    const dir = tempDir();
    const { opsStore, oppStore } = seedStores(dir);
    const brief = buildMorningBriefSurface({ opsStorePath: opsStore, opportunityStorePath: oppStore, now: new Date('2026-04-30T09:00:00.000Z'), limit: 3 });

    expect(brief.schema).toBe('gbrain.ops.morning_brief.v1');
    expect(brief.top_focus[0].id).toBe('pr-a13');
    expect(brief.yesterday_completions[0].id).toBe('pr-a12');
    expect(brief.top_opportunities).toHaveLength(1);
    expect(brief.guardrails.external_sent).toBe(false);
    expect(brief.guardrails.raw_vibes_used).toBe(false);
    expect(brief.guardrails.sources.map(s => s.kind)).toEqual(['ops_kernel', 'opportunity_radar']);
  });

  test('daily build report includes completions, checks, active work, and blockers', () => {
    const dir = tempDir();
    const { opsStore, oppStore } = seedStores(dir);
    const report = buildDailyBuildReportSurface({ opsStorePath: opsStore, opportunityStorePath: oppStore, now: new Date('2026-04-30T10:00:00.000Z') });

    expect(report.schema).toBe('gbrain.ops.daily_build_report.v1');
    expect(report.completed_work[0]).toMatchObject({ id: 'pr-a12', summary: 'pr-a12 shipped with gates.' });
    expect(report.completed_work[0].checks_run).toContain('bun run typecheck');
    expect(report.active_or_ready.some(w => w.id === 'pr-a13')).toBe(true);
    expect(report.failures_and_blockers.some(w => w.id === 'pr-a14')).toBe(true);
    expect(report.guardrails.trusted_personal_memory_mutated).toBe(false);
  });

  test('weekly strategy synthesis summarizes program progress, opportunity feedback, and next moves', () => {
    const dir = tempDir();
    const { opsStore, oppStore, candidateId } = seedStores(dir);
    recordOpportunityFeedback({ candidateId, value: 'useful', reason: 'high leverage', storePath: oppStore, now: new Date('2026-04-30T09:05:00.000Z') });
    const weekly = buildWeeklyStrategySynthesisSurface({ opsStorePath: opsStore, opportunityStorePath: oppStore, now: new Date('2026-04-30T12:00:00.000Z') });

    expect(weekly.schema).toBe('gbrain.ops.weekly_strategy_synthesis.v1');
    expect(weekly.program_progress[0].program_id).toBe('always-on-os');
    expect(weekly.program_progress[0].completed).toBe(1);
    expect(weekly.strategic_signals[0].id).toBe(candidateId);
    expect(weekly.feedback_learning.useful).toBe(1);
    expect(weekly.recommended_next_moves.length).toBeGreaterThan(0);
  });

  test('ops CLI can be triggered by cron to generate JSON or markdown files without sending externally', async () => {
    const dir = tempDir();
    const { opsStore, oppStore } = seedStores(dir);
    const out = join(dir, 'morning.json');
    const json = JSON.parse(await capture(() => runOpsCommand(null, ['brief', 'morning', '--store', opsStore, '--opportunities-store', oppStore, '--out', out, '--json'])));
    expect(json.schema).toBe('gbrain.ops.morning_brief.v1');
    expect(JSON.parse(readFileSync(out, 'utf8')).guardrails.external_sent).toBe(false);

    const md = await capture(() => runOpsCommand(null, ['brief', 'daily-build', '--store', opsStore, '--opportunities-store', oppStore, '--markdown']));
    expect(md).toContain('Daily build report');
    expect(md).toContain('nothing was sent externally');
  });
});
