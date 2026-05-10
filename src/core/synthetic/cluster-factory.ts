import { createHash } from 'node:crypto';
import type { SyntheticQueryCase, SyntheticQueryShape } from './types.ts';
import { SYNTHETIC_QUERY_SHAPES } from './types.ts';
import { validateSyntheticQueryCase } from './validator.ts';

export interface SyntheticSpanSeed {
  span_id: string;
  quote: string;
  source_item_id?: string;
  topic?: string;
  claim?: string;
  slug?: string;
  entities?: string[];
}

export interface ClusteredEvalInput {
  spans: SyntheticSpanSeed[];
  topic?: string;
  shapes?: SyntheticQueryShape[];
  hardNegatives?: boolean;
  countPerShape?: number;
}

export interface HighValueClusterCorpusInput extends Omit<ClusteredEvalInput, 'shapes' | 'countPerShape'> {
  /** Total query variants to emit for this evidence cluster. Must stay in the prescribed 20-100 range. */
  count?: number;
}

export const HIGH_VALUE_CLUSTER_SHAPES: SyntheticQueryShape[] = [
  'exact_fact',
  'approximate_recall',
  'vague_recall',
  'wrong_detail',
  'temporal',
  'alias',
  'emotional',
  'story',
  'why_not',
  'multilingual',
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'seed';
}

function stableId(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

function isGbs1Span(spanId: string): boolean {
  return /^gbs1:/.test(spanId);
}

function topicOrClaim(seed: SyntheticSpanSeed, topic?: string, claim?: string): string {
  return topic?.trim() || claim?.trim() || seed.topic?.trim() || seed.claim?.trim() || 'memory';
}

function sourceKey(seed: SyntheticSpanSeed): string {
  return seed.source_item_id?.trim() || seed.slug?.trim() || seed.span_id.replace(/^gbs1:/, '').split(':')[0] || seed.quote.slice(0, 24);
}

function entityKey(seed: SyntheticSpanSeed): string {
  return (seed.entities || []).map(e => e.trim().toLowerCase()).filter(Boolean).sort().join('|');
}

function shapeQuery(shape: SyntheticQueryShape, seed: SyntheticSpanSeed, topic?: string, claim?: string, hardNegative = false): { query: string; expectedAbstain: boolean; expectedClaimIds: string[] } {
  const label = topicOrClaim(seed, topic, claim);
  const suffix = hardNegative ? ' with a near-miss detail' : '';
  switch (shape) {
    case 'exact_fact': return { query: `What exact fact do we have about ${label}?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'approximate_recall': return { query: `What do we remember about ${label} in broad terms?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'vague_recall': return { query: `What was the gist of that ${label} thing?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'wrong_detail': return { query: `Did ${label} say the opposite of the stored evidence?`, expectedAbstain: true, expectedClaimIds: [] };
    case 'decision_arc': return { query: `Why did we move from or toward ${label}?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'relationship_arc': return { query: `How does ${label} relate to the other person or project?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'timeline': return { query: `What is the timeline for ${label}?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'temporal': return { query: `When did ${label} show up, and what was current then?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'alias': return { query: `What do we know if I refer to ${label} by its alias or shorthand?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'emotional': return { query: `What did ${label} feel frustrating, exciting, or emotionally salient about?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'story': return { query: `Tell me the source-backed story around ${label}. ${hardNegative ? 'Include an unsupported twist.' : 'Do not add unsupported details.'}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'why_not': return { query: `Why was ${label} not pursued?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'multilingual': return { query: `हमें ${label} के बारे में source-backed क्या याद है?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'medical_or_health': return { query: `What health or medical detail do we remember about ${label}?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
    case 'opportunity_memory': return { query: `What opportunity or next move did ${label} point to?${suffix}`, expectedAbstain: hardNegative, expectedClaimIds: hardNegative ? [] : [seed.span_id] };
  }
}

function groupSeeds(seeds: SyntheticSpanSeed[]): SyntheticSpanSeed[] {
  return [...seeds].sort((a, b) => {
    const ka = `${sourceKey(a)}|${entityKey(a)}|${a.span_id}`;
    const kb = `${sourceKey(b)}|${entityKey(b)}|${b.span_id}`;
    return ka.localeCompare(kb);
  });
}

export function generateClusteredEvalCases(input: ClusteredEvalInput): SyntheticQueryCase[] {
  const spans = groupSeeds(input.spans.map(s => {
    if (s.span_id.startsWith('syn:')) throw new Error('synthetic spans are not allowed');
    if (!isGbs1Span(s.span_id)) throw new Error('clustered eval cases require real gbs1 spans');
    return s;
  }));
  if (!spans.length) throw new Error('at least one gbs1 span is required');
  const shapes: SyntheticQueryShape[] = input.shapes?.length ? input.shapes : ['exact_fact'];
  const total = Math.max(1, (input.countPerShape || 1) * shapes.length);
  const out: SyntheticQueryCase[] = [];
  for (let i = 0; i < total; i++) {
    const shape: SyntheticQueryShape = shapes[i % shapes.length];
    const seed = spans[i % spans.length];
    const hardNegative = !!input.hardNegatives && i % 2 === 1;
    const clusterTopic = input.topic || seed.topic || seed.claim || 'memory';
    const { query, expectedAbstain, expectedClaimIds } = shapeQuery(shape, seed, clusterTopic, seed.claim, hardNegative);
    const payload: SyntheticQueryCase = {
      id: `synq_${stableId({ span: seed.span_id, shape, topic: clusterTopic, hardNegative, index: i })}`,
      seed_source_ids: seed.source_item_id ? [seed.source_item_id] : [],
      seed_evidence_span_ids: [seed.span_id],
      query,
      query_shape: shape,
      topic: clusterTopic,
      claim: seed.claim?.trim(),
      expected_claim_ids: expectedClaimIds,
      expected_abstain: expectedAbstain,
      hard_negative: hardNegative,
      eval_only: true,
      training_only: false,
      eligible_for_memory: false,
    };
    const issues = validateSyntheticQueryCase(payload);
    if (issues.length) throw new Error(`invalid clustered synthetic query case: ${issues.map(i => i.message).join('; ')}`);
    out.push(payload);
  }
  return out;
}

export function generateHighValueClusterQueryCorpus(input: HighValueClusterCorpusInput): SyntheticQueryCase[] {
  const count = input.count ?? 20;
  if (!Number.isInteger(count) || count < 20 || count > 100) throw new Error('high-value evidence clusters require 20-100 query variants');
  const perShape = Math.ceil(count / HIGH_VALUE_CLUSTER_SHAPES.length);
  return generateClusteredEvalCases({
    spans: input.spans,
    topic: input.topic,
    shapes: HIGH_VALUE_CLUSTER_SHAPES,
    hardNegatives: input.hardNegatives ?? true,
    countPerShape: perShape,
  }).slice(0, count);
}

export function buildSyntheticQueryCase(input: { seed: SyntheticSpanSeed; shape: SyntheticQueryShape; topic?: string; claim?: string; hardNegative?: boolean; index?: number }): SyntheticQueryCase {
  return generateClusteredEvalCases({ spans: [input.seed], topic: input.topic, shapes: [input.shape], hardNegatives: input.hardNegative, countPerShape: 1 })[0];
}

export function buildSyntheticQueryCases(input: { seeds: SyntheticSpanSeed[]; shapes?: SyntheticQueryShape[]; topic?: string; claim?: string; hardNegatives?: boolean; count?: number }): SyntheticQueryCase[] {
  return generateClusteredEvalCases({ spans: input.seeds, topic: input.topic || input.claim, shapes: input.shapes, hardNegatives: input.hardNegatives, countPerShape: input.count && input.shapes?.length ? Math.ceil(input.count / input.shapes.length) : input.count });
}

export function seedFromSpan(spanId: string, opts: { quote?: string; topic?: string; claim?: string; source_item_id?: string; slug?: string; entities?: string[] } = {}): SyntheticSpanSeed {
  if (!isGbs1Span(spanId)) throw new Error('seed gbs1 span required');
  return { span_id: spanId, quote: opts.quote?.trim() || spanId, topic: opts.topic, claim: opts.claim, source_item_id: opts.source_item_id, slug: opts.slug, entities: opts.entities };
}

export function describeSyntheticQueryCase(item: SyntheticQueryCase): string {
  return `${item.query_shape}:${slugify(item.topic || item.claim || item.query)}`;
}
