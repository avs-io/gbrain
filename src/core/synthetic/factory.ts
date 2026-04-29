import { createHash } from 'node:crypto';
import type { SyntheticQueryCase, SyntheticQueryShape } from './types.ts';
import { validateSyntheticQueryCase } from './validator.ts';

export interface SyntheticSpanSeed {
  span_id: string;
  quote: string;
  source_item_id?: string;
  topic?: string;
  claim?: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'seed';
}

function stableId(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

function topicOrClaim(seed: SyntheticSpanSeed, topic?: string, claim?: string): string {
  return topic?.trim() || claim?.trim() || seed.topic?.trim() || seed.claim?.trim() || 'memory';
}

function queryForShape(shape: SyntheticQueryShape, seed: SyntheticSpanSeed, topic?: string, claim?: string, hardNegative = false): { query: string; expectedAbstain: boolean; expectedClaimIds: string[] } {
  const label = topicOrClaim(seed, topic, claim);
  const nearMiss = hardNegative ? ` with a near-miss detail` : '';
  switch (shape) {
    case 'exact_fact':
      return { query: `What exact fact do we have about ${label}?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'approximate_recall':
      return { query: `What do we remember about ${label} in broad terms?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'decision_arc':
      return { query: `Why did we move from or toward ${label}?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'relationship_arc':
      return { query: `How does ${label} relate to the other person or project?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'timeline':
      return { query: `What is the timeline for ${label}?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'why_not':
      return { query: `Why was ${label} not pursued?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'medical_or_health':
      return { query: `What health or medical detail do we remember about ${label}?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'opportunity_memory':
      return { query: `What opportunity or next move did ${label} point to?${nearMiss}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
  }
}

export function buildSyntheticQueryCase(input: { seed: SyntheticSpanSeed; shape: SyntheticQueryShape; topic?: string; claim?: string; hardNegative?: boolean; index?: number }): SyntheticQueryCase {
  const { query, expectedAbstain, expectedClaimIds } = queryForShape(input.shape, input.seed, input.topic, input.claim, input.hardNegative);
  const payload: SyntheticQueryCase = {
    id: `synq_${stableId({ span: input.seed.span_id, shape: input.shape, topic: input.topic || '', claim: input.claim || '', hardNegative: !!input.hardNegative, index: input.index ?? 0 })}`,
    seed_source_ids: input.seed.source_item_id ? [input.seed.source_item_id] : [],
    seed_evidence_span_ids: [input.seed.span_id],
    query,
    query_shape: input.shape,
    topic: topicOrClaim(input.seed, input.topic, input.claim),
    claim: input.claim?.trim() || input.seed.claim?.trim(),
    expected_claim_ids: expectedClaimIds,
    expected_abstain: expectedAbstain,
    hard_negative: !!input.hardNegative,
    eval_only: true,
    training_only: false,
    eligible_for_memory: false,
  };
  const issues = validateSyntheticQueryCase(payload);
  if (issues.length) throw new Error(`invalid synthetic query case: ${issues.join('; ')}`);
  return payload;
}

export function buildSyntheticQueryCases(input: { seeds: SyntheticSpanSeed[]; shapes?: SyntheticQueryShape[]; topic?: string; claim?: string; hardNegatives?: boolean; count?: number }): SyntheticQueryCase[] {
  const shapes: SyntheticQueryShape[] = input.shapes?.length ? input.shapes : ['exact_fact'];
  const out: SyntheticQueryCase[] = [];
  const target = input.count && input.count > 0 ? input.count : shapes.length * input.seeds.length;
  for (let i = 0; i < target; i++) {
    const seed = input.seeds[i % input.seeds.length];
    const shape = shapes[i % shapes.length];
    const hardNegative = !!input.hardNegatives && i % 2 === 1;
    const label = input.topic || input.claim || seed.topic || seed.claim || 'memory';
    const caseObj = buildSyntheticQueryCase({ seed, shape, topic: label, claim: input.claim, hardNegative, index: i });
    out.push(caseObj);
  }
  return out;
}

export function seedFromSpan(spanId: string, opts: { quote?: string; topic?: string; claim?: string } = {}): SyntheticSpanSeed {
  if (!/^gbs1:/.test(spanId)) throw new Error('seed gbs1 span required');
  return { span_id: spanId, quote: opts.quote?.trim() || spanId, topic: opts.topic, claim: opts.claim };
}

export function describeSyntheticQueryCase(item: SyntheticQueryCase): string {
  return `${item.query_shape}:${slugify(item.topic || item.claim || item.query)}`;
}
