import { createHash } from 'node:crypto';

export interface ScoutRecipe {
  id: string;
  topic: string;
  title: string;
  description: string;
  public: true;
  keywords: string[];
  action_templates: string[];
}

export interface ScoutSignal {
  id: string;
  topic: string;
  source_url?: string;
  source_title?: string;
  published_at?: string;
  entities: string[];
  claim: string;
  evidence_excerpt: string;
  novelty_score: number;
  relevance_score: number;
  urgency_score: number;
  confidence: number;
  suggested_actions: string[];
  matched_memory_refs: string[];
}

export interface ScoutSourceInput {
  source_url?: string;
  source_title?: string;
  published_at?: string;
  excerpt: string;
  claim: string;
  entities?: string[];
}

export const BUILTIN_SCOUT_RECIPES: ScoutRecipe[] = [
  {
    id: 'sovereign-ai-india',
    topic: 'sovereign-ai-india',
    title: 'Sovereign AI India',
    description: 'Public signals about India-aligned sovereign AI, policy, infra, and ecosystem moves.',
    public: true,
    keywords: ['india', 'sovereign', 'ai', 'policy', 'compute', 'infra', 'foundation model'],
    action_templates: ['brief the board', 'compare against current stance', 'track for follow-up'],
  },
  {
    id: 'ai-agent-infra',
    topic: 'ai-agent-infra',
    title: 'AI Agent Infra',
    description: 'Public signals about agent infrastructure, orchestration, evals, memory, and tooling.',
    public: true,
    keywords: ['agent', 'orchestration', 'memory', 'eval', 'tool', 'workflow', 'infra'],
    action_templates: ['capture implementation idea', 'compare to current stack', 'queue for review'],
  },
  {
    id: 'health-os-personalization',
    topic: 'health-os-personalization',
    title: 'Health OS Personalization',
    description: 'Public signals about personalized health operating systems, personalization, and care loops.',
    public: true,
    keywords: ['health', 'personalization', 'care', 'wellness', 'clinical', 'sensor', 'os'],
    action_templates: ['assess product fit', 'track clinical implications', 'queue for review'],
  },
];

function stableId(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return norm(value).split(/\s+/).filter(Boolean);
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(v => v.trim()).filter(Boolean))];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(3))));
}

function scoreOverlap(haystack: string, needles: string[]): number {
  if (!needles.length) return 0;
  const hay = norm(haystack);
  const hits = needles.filter(n => hay.includes(n));
  return hits.length / needles.length;
}

export function buildScoutSignalFromSource(input: { recipe: ScoutRecipe; source: ScoutSourceInput }): ScoutSignal {
  const { recipe, source } = input;
  if (!source.source_url && !source.source_title) {
    throw new Error('Public scout signals require source_url or source_title');
  }

  const excerpt = source.excerpt.trim();
  const claim = source.claim.trim();
  const entities = unique(source.entities || []);
  const baseText = [recipe.topic, recipe.title, recipe.description, source.source_title || '', excerpt, claim, entities.join(' ')].join(' ');
  const keywordHits = scoreOverlap(baseText, recipe.keywords);
  const entityBoost = Math.min(0.2, entities.length * 0.05);
  const excerptLenBoost = excerpt.length > 240 ? 0.08 : excerpt.length > 120 ? 0.05 : excerpt.length > 40 ? 0.02 : 0;
  const novelty = clamp(0.18 + (1 - keywordHits) * 0.45 + excerptLenBoost + entityBoost);
  const relevance = clamp(0.22 + keywordHits * 0.55 + Math.min(0.12, tokenize(claim).length / 50));
  const urgency = clamp(0.08 + (claim.includes('now') || claim.includes('launch') || claim.includes('urgent') ? 0.22 : 0) + (source.published_at ? 0.05 : 0));
  const confidence = clamp(0.28 + keywordHits * 0.35 + Math.min(0.15, excerpt.length / 400));

  const suggestions = unique([
    ...(keywordHits > 0.34 ? ['compare against current research'] : []),
    ...(novelty >= 0.5 ? ['save for review'] : []),
    ...(urgency >= 0.25 ? ['surface to reviewer'] : []),
    ...recipe.action_templates.slice(0, 2),
  ]).slice(0, 4);

  const matched_memory_refs = unique(
    tokenize(baseText)
      .filter(t => t.length > 4)
      .slice(0, 4)
      .map(t => `memory:${t}`),
  );

  return {
    id: `scout_sig_${stableId({ recipe: recipe.id, source_url: source.source_url || '', source_title: source.source_title || '', claim, excerpt, entities })}`,
    topic: recipe.topic,
    source_url: source.source_url,
    source_title: source.source_title,
    published_at: source.published_at,
    entities,
    claim,
    evidence_excerpt: excerpt,
    novelty_score: novelty,
    relevance_score: relevance,
    urgency_score: urgency,
    confidence,
    suggested_actions: suggestions,
    matched_memory_refs,
  };
}

export function scoutReportJson(signal: ScoutSignal): Record<string, unknown> {
  return {
    schema: 'gbrain.scout.signal.review.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    signal,
  };
}

export function scoutRecipeById(id: string): ScoutRecipe | undefined {
  return BUILTIN_SCOUT_RECIPES.find(r => r.id === id);
}
