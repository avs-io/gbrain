import { describe, expect, test } from 'bun:test';
import { buildDeterministicPersonalContextPack, validatePersonalContextPack } from '../src/core/context/personal-pack.ts';
import { runMemory } from '../src/commands/memory.ts';

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('personal context pack', () => {
  test('builds local-only pack with evidence-backed facts and labeled preferences', () => {
    const pack = buildDeterministicPersonalContextPack({
      task: 'opportunity_eval',
      subject: '/Users/a/private/topic',
      facts: ['Evidence-backed fact should require source.'],
      preferences: ['Keep updates concise.'],
      inferences: ['This is inferred, not memory.'],
      evidence: [{ span_id: 'gbs1:default:sources/test#compiled_truth:L1-L2', quote: 'Evidence-backed fact should require source.' }],
      generatedAt: '2026-04-29T18:00:00Z',
    });

    expect(pack.schema).toBe('gbrain.personal_context_pack.v1');
    expect(pack.profile).toBe('aditya');
    expect(pack.subject).not.toContain('/Users/a');
    expect(pack.evidence_index).toHaveLength(1);
    expect(pack.sections.identity_constraints[0].kind).toBe('fact');
    expect(pack.sections.identity_constraints[0].evidence_span_ids[0]).toMatch(/^gbs1:/);
    expect(pack.sections.communication_preferences[0].kind).toBe('preference');
    expect(pack.metadata.guardrails.model_api_calls).toBe(false);
    expect(validatePersonalContextPack(pack)).toEqual([]);
  });

  test('validator rejects factual entries without evidence', () => {
    const pack = buildDeterministicPersonalContextPack({ task: 'memory_answer', snippets: [{ section: 'active_context', text: 'Unsupported fact.', kind: 'fact' }] });
    expect(validatePersonalContextPack(pack).join(' ')).toContain('fact entries require evidence_span_ids');
  });

  test('CLI emits JSON through memory and personal aliases', async () => {
    const args = ['personal', 'context-pack', '--profile', 'aditya', '--task', 'opportunity_eval', '--topic', 'Synthetic eval', '--evidence', 'gbs1:default:sources/test#compiled_truth:L1-L2', '--fact', 'Evidence-backed work matters.', '--preference', 'Keep updates concise.', '--json'];
    const memoryPayload = JSON.parse(await capture(() => runMemory(args)));
    expect(memoryPayload.ok).toBe(true);
    expect(memoryPayload.action).toBe('personal-context-pack');
    expect(memoryPayload.metadata.privacy).toBe('local_only');
  });
});
