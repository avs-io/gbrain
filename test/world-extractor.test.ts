import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorldCommand } from '../src/commands/world.ts';
import { BUILTIN_SCOUT_RECIPES } from '../src/core/scout/pipeline.ts';
import { runPublicScout } from '../src/core/scout/runner.ts';
import {
  deterministicSupportValidator,
  extractWorldCandidatesFromScout,
  validateWorldExtractionReport,
} from '../src/core/world/extractor.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('world candidate extractor', () => {
  test('extracts schema-valid candidate claims, events, and entity updates from public scout spans', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[0]!;
    const scout = runPublicScout({
      recipe,
      now: new Date('2026-04-30T04:00:00.000Z'),
      sources: [
        {
          source_url: 'https://example.com/indiaai-compute',
          source_title: 'IndiaAI compute announcement',
          published_at: '2026-04-29T00:00:00.000Z',
          claim: 'IndiaAI Mission announced a sovereign AI compute procurement update.',
          excerpt: 'On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
          content: 'Briefing. On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups. End.',
          entities: ['IndiaAI Mission'],
        },
      ],
    });

    const out = extractWorldCandidatesFromScout(scout, { topic: 'sovereign-ai-india', now: new Date('2026-04-30T05:00:00.000Z') });
    expect(validateWorldExtractionReport(out)).toEqual([]);
    expect(out.trusted_world_truth).toBe(false);
    expect(out.claims).toHaveLength(1);
    expect(out.events).toHaveLength(1);
    expect(out.entity_updates).toHaveLength(1);
    expect(out.claims[0]!.status).toBe('candidate');
    expect(out.claims[0]!.support_status).toBe('supported');
    expect(out.claims[0]!.source_refs[0]!.source_span_id).toBe(scout.source_spans[0]!.ref);
    expect(out.events[0]!.event_type).toBe('announcement');
    expect(out.entity_updates[0]!.entity).toBe('IndiaAI Mission');
    for (const candidate of [...out.claims, ...out.events, ...out.entity_updates]) {
      expect(candidate.source_refs.length).toBeGreaterThan(0);
      expect(candidate.source_refs.every(ref => ref.source_span_id.startsWith('srcspan1:'))).toBe(true);
    }
  });

  test('noisy article and false extraction lure are marked unsupported instead of verified/trusted', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[1]!;
    const scout = runPublicScout({
      recipe,
      sources: [
        {
          source_url: 'https://example.com/noisy-memory-rumor',
          source_title: 'Noisy roundup',
          claim: 'Mem0 acquired Zep in a confirmed transaction.',
          excerpt: 'Noisy roundup: a false rumor claimed Mem0 acquired Zep, but the article says the rumor was denied and not confirmed by either company.',
          content: 'Noisy roundup: a false rumor claimed Mem0 acquired Zep, but the article says the rumor was denied and not confirmed by either company. The rest is speculation.',
          entities: ['Mem0', 'Zep'],
        },
      ],
    });

    const out = extractWorldCandidatesFromScout(scout, { topic: 'agent-memory-systems' });
    expect(validateWorldExtractionReport(out)).toEqual([]);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0]!.status).toBe('candidate');
    expect(out.claims[0]!.support_status).toBe('unsupported');
    expect(out.claims[0]!.unsupported_reason).toContain('noisy or negating');
    expect(out.claims[0]!.source_refs[0]!.source_span_id).toBe(scout.source_spans[0]!.ref);
    expect(out.diagnostics.unsupported_candidates).toBeGreaterThan(0);
  });

  test('private or non-world spans are rejected before candidate construction', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[2]!;
    const scout = runPublicScout({
      recipe,
      sources: [{ source_url: 'https://example.com/agent-launch', claim: 'Agent infra launch', excerpt: 'Agent infra launch announced.', entities: ['AgentCo'] }],
    });
    scout.source_spans[0] = { ...scout.source_spans[0]!, privacy: 'P1_PRIVATE' };
    const out = extractWorldCandidatesFromScout(scout);
    expect(out.claims).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.entity_updates).toEqual([]);
    expect(out.diagnostics.rejected_candidates).toBe(1);
  });

  test('deterministic support validator refuses unrelated lure text', () => {
    const result = deterministicSupportValidator('OpenAI launched a new memory benchmark', [
      { source_span_id: 'srcspan1:web:abc#char:0-50', source_item_id: 'web:abc', quote: 'Anthropic published a citation API article about source-grounded answers.' },
    ]);
    expect(result.status).toBe('unsupported');
    expect(result.reason).toContain('insufficient lexical support');
  });
});

describe('world extractor CLI', () => {
  test('gbrain world extract reads scout report from --from-run and emits json', async () => {
    const recipe = BUILTIN_SCOUT_RECIPES[2]!;
    const scout = runPublicScout({
      recipe,
      sources: [{ source_url: 'https://example.com/langgraph', claim: 'LangGraph announced a workflow orchestration update.', excerpt: 'LangGraph announced a workflow orchestration update for production AI agents.', entities: ['LangGraph'] }],
    });
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-world-extract-'));
    const reportPath = join(dir, 'scout-report.json');
    writeFileSync(reportPath, JSON.stringify(scout), 'utf8');

    const stdout = await captureStdout(() => runWorldCommand(null, ['extract', 'ai-agent-infra', '--from-run', reportPath, '--json']));
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.extraction.schema).toBe('gbrain.world.extraction_report.v1');
    expect(parsed.extraction.claims[0].source_refs[0].source_span_id).toBe(scout.source_spans[0]!.ref);
  });
});
