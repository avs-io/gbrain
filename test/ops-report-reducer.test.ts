import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { auditUnreducedArtifacts, readReportReductionRecords, reduceReportArtifact } from '../src/core/ops/report-reducer.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-report-reducer-')); }
function now(): Date { return new Date('2026-04-30T10:00:00.000Z'); }

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

describe('ops report reducer and unreduced artifact audit', () => {
  test('report reduces into topic/source-span candidate input without trusted memory mutation', () => {
    const dir = tempDir();
    const input = join(dir, 'topic-report.md');
    const store = join(dir, 'report-reductions.jsonl');
    writeFileSync(input, '# Evidence\nAccording to the Ministry source, IndiaAI announced a compute procurement deadline for sovereign AI startups. Source quote: startups need local evaluation capacity.');

    const report = reduceReportArtifact({ inputPath: input, topicId: 'world-sovereign-ai-india', domain: 'sovereign-ai', artifactStorePath: store, storePath: join(dir, 'ops.jsonl'), now: now(), createWorkItems: false });

    expect(report.schema).toBe('gbrain.ops.report_reduction_report.v1');
    expect(report.topic_evidence_candidate_inputs).toHaveLength(1);
    expect(report.records[0].reduction_target).toBe('topic_evidence_candidate_input');
    expect(report.records[0].trusted_memory_mutated).toBe(false);
    expect(report.safety.trusted_personal_memory_mutated).toBe(false);
    expect(readReportReductionRecords(store)[0].source_artifact_ref.sha256).toBe(report.source_artifact_ref.sha256);
  });

  test('report reduces into opportunity and action item with review-only WorkItem', () => {
    const dir = tempDir();
    const input = join(dir, 'opp-report.md');
    const reductions = join(dir, 'reductions.jsonl');
    const ops = join(dir, 'ops.jsonl');
    writeFileSync(input, '# Opportunity\nWhy now: a startup bottleneck and market gap create an opportunity to run a pilot. Recommended next step: build a small evaluation harness and draft a proposal before the deadline.');

    const report = reduceReportArtifact({ inputPath: input, topicId: 'world-sovereign-ai-india', domain: 'sovereign-ai', artifactStorePath: reductions, storePath: ops, now: now() });

    expect(report.opportunity_candidate_inputs).toHaveLength(1);
    expect(report.action_work_item_inputs).toHaveLength(1);
    expect(report.records.map(r => r.reduction_target)).toEqual(expect.arrayContaining(['opportunity_candidate_input', 'action_work_item_input']));
    expect(report.created_work_items).toHaveLength(1);
    expect(report.created_work_items[0].approval_gates).toContain('human_review_before_external_action');
    expect(readFileSync(ops, 'utf8')).toContain('report reducer created review-only work item');
  });

  test('low-signal report is explicitly archived/discarded', () => {
    const dir = tempDir();
    const input = join(dir, 'noise.md');
    writeFileSync(input, '# Routine\nNo material change. FYI only.');

    const report = reduceReportArtifact({ inputPath: input, artifactStorePath: join(dir, 'reductions.jsonl'), now: now() });

    expect(report.topic_evidence_candidate_inputs).toHaveLength(0);
    expect(report.opportunity_candidate_inputs).toHaveLength(0);
    expect(report.action_work_item_inputs).toHaveLength(0);
    expect(report.discard_records[0].status).toBe('discarded');
    expect(report.discard_records[0].reason).toContain('low-signal');
  });

  test('unreduced artifact audit flags missing reduction record', () => {
    const dir = tempDir();
    const unreduced = join(dir, 'unreduced.md');
    const manifest = join(dir, 'manifest.json');
    writeFileSync(unreduced, '# Evidence\nA source reported a policy signal that needs reduction.');
    writeFileSync(manifest, JSON.stringify({ artifacts: [{ path: unreduced }] }));

    const audit = auditUnreducedArtifacts({ manifestPath: manifest, reductionStorePath: join(dir, 'empty.jsonl'), now: now() });

    expect(audit.schema).toBe('gbrain.ops.unreduced_artifact_audit.v1');
    expect(audit.unreduced_count).toBe(1);
    expect(audit.unreduced_artifacts[0].path).toBe(unreduced);
  });

  test('reduced and discarded artifacts are not flagged by audit', () => {
    const dir = tempDir();
    const reduced = join(dir, 'reduced.md');
    const discarded = join(dir, 'discarded.md');
    const manifest = join(dir, 'manifest.json');
    const store = join(dir, 'reductions.jsonl');
    writeFileSync(reduced, '# Evidence\nSource reported a procurement deadline and claim for sovereign AI compute. According to the official source, the policy signal changes startup evaluation timing and includes source-backed evidence.');
    writeFileSync(discarded, '# Routine\nNo actionable signal.');
    reduceReportArtifact({ inputPath: reduced, artifactStorePath: store, now: now(), createWorkItems: false });
    reduceReportArtifact({ inputPath: discarded, artifactStorePath: store, now: now(), createWorkItems: false });
    writeFileSync(manifest, JSON.stringify([reduced, discarded]));

    const audit = auditUnreducedArtifacts({ manifestPath: manifest, reductionStorePath: store, now: now() });

    expect(audit.unreduced_count).toBe(0);
    expect(audit.covered_count).toBe(2);
    expect(audit.covered_artifacts.map(a => a.status)).toEqual(expect.arrayContaining(['reduced', 'discarded']));
  });

  test('CLI reduce and audit-unreduced emit JSON and do not touch trusted memory', async () => {
    const dir = tempDir();
    const input = join(dir, 'cli-report.md');
    const reductions = join(dir, 'reductions.jsonl');
    const ops = join(dir, 'ops.jsonl');
    const trustedMemory = join(dir, 'MEMORY.md');
    writeFileSync(input, '# Next step\nEvidence from a source shows a market gap. Recommended action: investigate a pilot work item.');
    writeFileSync(trustedMemory, 'do not mutate me');

    const out = JSON.parse(await capture(() => runOpsCommand(null, ['reports', 'reduce', '--input', input, '--topic', 'world-sovereign-ai-india', '--artifact-store', reductions, '--store', ops, '--json'])));
    expect(out.records.length).toBeGreaterThan(0);
    expect(out.safety.trusted_memory_mutated).toBe(false);
    expect(readFileSync(trustedMemory, 'utf8')).toBe('do not mutate me');

    const audit = JSON.parse(await capture(() => runOpsCommand(null, ['reports', 'audit-unreduced', '--dir', dir, '--artifact-store', reductions, '--json'])));
    expect(audit.covered_artifacts.some((a: any) => a.absolute_path === input)).toBe(true);
    expect(existsSync(reductions)).toBe(true);
  });
});
