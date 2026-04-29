import type { SyntheticQueryCase, SyntheticQueryShape } from './types.ts';
import { generateClusteredEvalCases, seedFromSpan } from './cluster-factory.ts';

export { generateClusteredEvalCases, seedFromSpan };

export function buildSyntheticQueryCase(input: { seed: { span_id: string; quote: string; source_item_id?: string; topic?: string; claim?: string; slug?: string; entities?: string[] }; shape: SyntheticQueryShape; topic?: string; claim?: string; hardNegative?: boolean; index?: number }): SyntheticQueryCase {
  return generateClusteredEvalCases({ spans: [input.seed], topic: input.topic, shapes: [input.shape], hardNegatives: input.hardNegative, countPerShape: 1 })[0];
}

export function buildSyntheticQueryCases(input: { seeds: Array<{ span_id: string; quote: string; source_item_id?: string; topic?: string; claim?: string; slug?: string; entities?: string[] }>; shapes?: SyntheticQueryShape[]; topic?: string; claim?: string; hardNegatives?: boolean; count?: number }): SyntheticQueryCase[] {
  return generateClusteredEvalCases({ spans: input.seeds, topic: input.topic || input.claim, shapes: input.shapes, hardNegatives: input.hardNegatives, countPerShape: input.count && input.shapes?.length ? Math.ceil(input.count / input.shapes.length) : input.count });
}

export function describeSyntheticQueryCase(item: SyntheticQueryCase): string {
  return `${item.query_shape}:${(item.topic || item.claim || item.query).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'seed'}`;
}
