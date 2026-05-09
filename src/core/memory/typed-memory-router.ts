import { loadTypedMemoryStore } from './typed-memory-store.ts';
import type { TypedMemoryItem, TypedMemoryRoute, TypedMemoryRouteResult } from './types.ts';

const TYPE_ORDER = [
  'core_memory',
  'procedure_memory',
  'relationship_memory',
  'proactive_candidate',
  'semantic_fact',
  'preference_signal',
  'opportunity_memory',
  'episode',
];

export const TYPED_MEMORY_ROUTES: TypedMemoryRoute[] = [
  {
    id: 'citadel-lineage',
    label: 'Citadel lineage / sovereign cognition',
    terms: ['citadel', 'sovereign cognition', 'cognitive fortress', 'post-human', 'human+ai', 'root-stock', 'anti-programming', 'programmable drift'],
    entities: ['Citadel', 'sovereign cognition', 'post-human intelligence', 'cognitive fortress'],
    types: ['episode', 'semantic_fact', 'proactive_candidate'],
    intent: 'historical_arc',
  },
  {
    id: 'local-model-worker-lane',
    label: 'Local model / MLX worker lane',
    terms: ['mlx', 'local model', 'local models', 'qwen', 'qwen2.5', 'worker lane', 'bounded worker', 'model routing', 'm3 ultra'],
    entities: ['MLX', 'local models', 'Qwen2.5 7B', 'worker architecture', 'model routing'],
    types: ['preference_signal', 'opportunity_memory', 'proactive_candidate', 'procedure_memory', 'core_memory'],
    intent: 'preference_opportunity',
  },
  {
    id: 'government-outreach',
    label: 'Sovereign AI government outreach',
    terms: ['somnath', 'government outreach', 'judicial ai', 'e-committee', 'ecommittee', 'bharatgen', 'gem', 's. krishnan', 'sovereign ai pilot'],
    entities: ['Somnath', 'S. Krishnan', 'e-Committee', 'BharatGen', 'GeM'],
    types: ['relationship_memory', 'procedure_memory', 'proactive_candidate', 'core_memory'],
    intent: 'relationship_open_loop',
  },
  {
    id: 'sovereign-ai-strategy-pivot',
    label: 'Sovereign AI strategy / current-vs-stale procurement posture',
    terms: ['sovereign ai', 'primary focus', 'primary current', 'eonic', 'gem', 'procurement', 'productized pilot', 'consulting-led', 'stale', 'superseded', 'current truth', 'historical truth'],
    entities: ['Sovereign AI', 'Eonic', 'GeM', 'procurement'],
    types: ['core_memory', 'episode', 'semantic_fact'],
    intent: 'current_vs_historical_truth',
  },
  {
    id: 'typed-memory-integration',
    label: 'GBrain typed-memory substrate / native integration',
    terms: ['typed memory', 'typed-memory', 'memory products', 'living-memory substrate', 'native gbrain', 'memory substrate', 'integrating native gbrain'],
    entities: ['GBrain', 'typed memory', 'living-memory substrate'],
    types: ['semantic_fact', 'procedure_memory', 'episode'],
    intent: 'native_integration_design',
  },
  {
    id: 'trusted-writeback',
    label: 'Trusted GBrain write-back governance',
    terms: ['trusted write', 'writeback', 'write-back', 'propose-memory', 'trusted brain', 'brain pages', 'direct edit', 'governed proposal'],
    entities: ['GBrain', 'propose-memory', 'trusted brain pages'],
    types: ['procedure_memory', 'core_memory'],
    intent: 'procedure_governance',
  },
];

function norm(s: unknown): string { return String(s || '').toLowerCase(); }
function termHit(text: string, term: string): boolean { return norm(text).includes(norm(term)); }
function tokenSet(s: string): Set<string> { return new Set(norm(s).split(/[^a-z0-9.+-]+/).filter(t => t.length >= 3)); }
function overlapScore(text: string, values: readonly string[] = []): number {
  const t = norm(text);
  let score = 0;
  for (const v of values) {
    const n = norm(v);
    if (n && t.includes(n)) score += Math.max(2, Math.min(6, n.split(/\s+/).length + 1));
  }
  return score;
}

const GENERIC_DIRECT_MATCH_VALUES = new Set(['chief', 'claw', 'gbrain', 'external actions']);
function directMatchValues(item: TypedMemoryItem): string[] {
  return [
    item.title,
    item.claim,
    ...(item.entities || []).filter(e => !GENERIC_DIRECT_MATCH_VALUES.has(norm(e))),
    ...(item.tags || []).filter(t => !['core', 'procedure'].includes(norm(t))),
  ];
}

export function detectTypedMemoryRoutes(text: string) {
  const matches = [];
  const qTokens = tokenSet(text);
  for (const route of TYPED_MEMORY_ROUTES) {
    let score = 0;
    const hits: string[] = [];
    for (const term of route.terms) {
      if (termHit(text, term)) { score += Math.max(3, term.split(/\s+/).length + 2); hits.push(term); }
      else if (qTokens.has(norm(term))) { score += 2; hits.push(term); }
    }
    score += overlapScore(text, route.entities);
    if (score > 0) matches.push({ ...route, score, hits: [...new Set(hits)] });
  }
  const hasGov = matches.some(m => m.id === 'government-outreach');
  const strategySpecific = new Set(['primary focus', 'primary current', 'eonic', 'procurement', 'productized pilot', 'consulting-led', 'stale', 'superseded', 'current truth', 'historical truth']);
  return matches.filter(m => {
    if (!hasGov || m.id !== 'sovereign-ai-strategy-pivot') return true;
    return m.hits.some(h => strategySpecific.has(norm(h)));
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function itemScore(item: TypedMemoryItem, routes: ReturnType<typeof detectTypedMemoryRoutes>, text: string): { score: number; reasons: string[] } {
  let score = 0;
  let affinity = 0;
  const reasons: string[] = [];
  for (const route of routes) {
    const entityScore = overlapScore(route.entities.join(' '), item.entities || []);
    if (entityScore) { score += entityScore * 2; affinity += entityScore; reasons.push('entity'); }
    const tagScore = overlapScore(route.terms.join(' '), item.tags || []);
    if (tagScore) { score += tagScore; affinity += tagScore; reasons.push('tag'); }
    const directScore = overlapScore(text, directMatchValues(item));
    if (directScore) { score += directScore; affinity += directScore; reasons.push('direct'); }
    if (route.types.includes(item.memory_type) && affinity > 0) { score += 5; reasons.push(`type:${item.memory_type}`); }
  }
  if (affinity === 0) return { score: 0, reasons: [] };
  if (item.status === 'validated') score += 2;
  if (item.status === 'candidate') score += 1;
  if (item.surfacing_policy === 'never') score -= 4;
  if (item.sensitivity === 'high') score -= 1;
  return { score, reasons: [...new Set(reasons)] };
}

export function routeTypedMemory(opts: { query?: string; context?: string; limit?: number; includeHigh?: boolean; fixturePath?: string } = {}): TypedMemoryRouteResult {
  const query = opts.query || '';
  const context = opts.context || '';
  const limit = opts.limit || 8;
  const text = [query, context].filter(Boolean).join('\n');
  const routeMatches = detectTypedMemoryRoutes(text);
  const desiredTypes = [...new Set(routeMatches.flatMap(r => r.types))];
  const desiredEntities = [...new Set(routeMatches.flatMap(r => r.entities))];
  const store = loadTypedMemoryStore({ path: opts.fixturePath });
  const results = store.items.map(item => {
    const s = itemScore(item, routeMatches, text);
    return { item, ...s };
  }).filter(r => r.score > 0)
    .filter(r => desiredTypes.length === 0 || desiredTypes.includes(r.item.memory_type))
    .filter(r => opts.includeHigh || r.item.sensitivity !== 'high')
    .sort((a, b) => b.score - a.score || TYPE_ORDER.indexOf(a.item.memory_type) - TYPE_ORDER.indexOf(b.item.memory_type) || a.item.id.localeCompare(b.item.id))
    .slice(0, limit)
    .map(r => ({
      id: r.item.id,
      memory_type: r.item.memory_type,
      title: r.item.title,
      claim: r.item.claim,
      score: r.score,
      reasons: r.reasons,
      sensitivity: r.item.sensitivity,
      permission_scope: r.item.permission_scope,
      surfacing_policy: r.item.surfacing_policy,
      source: r.item.source,
      entities: r.item.entities,
      status: r.item.status,
    }));

  return {
    generated_at: new Date().toISOString(),
    query,
    context: context || undefined,
    fixture: store.displayPath,
    matched_routes: routeMatches.map(r => ({ id: r.id, label: r.label, intent: r.intent, score: r.score, hits: r.hits })),
    desired_memory_types: desiredTypes,
    desired_entities: desiredEntities,
    results,
    pass: routeMatches.length > 0 && results.length > 0,
    warnings: store.warnings,
  };
}
