import { createHash } from 'node:crypto';

export type ScoutCadence = 'daily' | 'weekly' | 'event_driven';
export type ScoutOutputKind = 'query_plan' | 'claim_candidates' | 'radar_candidates' | 'briefing_note';

export interface TopicTrack {
  schema: 'gbrain.topic_track.v1';
  slug: string;
  title: string;
  objective: string;
  description: string;
  namespace: 'world' | 'scouts';
  privacy: 'public';
  cadence: ScoutCadence;
  watch_entities: string[];
  seed_queries: string[];
}

export interface ScoutRecipeBudgets {
  max_queries_per_run: number;
  max_results_per_query: number;
  max_runtime_seconds: number;
  max_external_fetches: number;
}

export interface ScoutRecipeOutputs {
  kinds: ScoutOutputKind[];
  review_only: true;
  trusted_world_updates: false;
}

export interface ScoutRecipe {
  schema: 'gbrain.scout.recipe.v1';
  slug: string;
  id: string;
  topic: string;
  title: string;
  objective: string;
  description: string;
  public: true;
  keywords: string[];
  seed_queries: string[];
  watch_entities: string[];
  budgets: ScoutRecipeBudgets;
  outputs: ScoutRecipeOutputs;
  action_templates: string[];
  topic_track: TopicTrack;
}

export interface ScoutQueryPlanItem {
  id: string;
  query: string;
  purpose: 'seed_query' | 'entity_watch';
  watch_entities: string[];
  expected_outputs: ScoutOutputKind[];
  budget: Pick<ScoutRecipeBudgets, 'max_results_per_query'>;
}

export interface ScoutQueryPlan {
  schema: 'gbrain.scout.query_plan.v1';
  mode: 'dry-run';
  fetching_allowed: false;
  recipe_slug: string;
  objective: string;
  budgets: ScoutRecipeBudgets;
  query_count: number;
  queries: ScoutQueryPlanItem[];
  warnings: string[];
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
  suggested_actions: ScoutSuggestedAction[];
  matched_memory_refs: string[];
}

export type ScoutSuggestedActionType = 'compare' | 'save_for_review' | 'surface_to_reviewer' | 'recipe_template';

export interface ScoutSuggestedAction {
  type: ScoutSuggestedActionType;
  label: string;
  rationale: string;
  review_only: true;
  external_action_allowed: false;
  trusted_memory_write_allowed: false;
}

export interface ScoutSourceInput {
  source_url?: string;
  source_title?: string;
  published_at?: string;
  excerpt: string;
  claim: string;
  entities?: string[];
}

function makeRecipe(input: Omit<ScoutRecipe, 'schema' | 'id' | 'topic' | 'public' | 'topic_track'>): ScoutRecipe {
  const topicTrack: TopicTrack = {
    schema: 'gbrain.topic_track.v1',
    slug: input.slug,
    title: input.title,
    objective: input.objective,
    description: input.description,
    namespace: 'world',
    privacy: 'public',
    cadence: 'daily',
    watch_entities: input.watch_entities,
    seed_queries: input.seed_queries,
  };
  return {
    schema: 'gbrain.scout.recipe.v1',
    id: input.slug,
    topic: input.slug,
    public: true,
    topic_track: topicTrack,
    ...input,
  };
}

export const BUILTIN_SCOUT_RECIPES: ScoutRecipe[] = [
  makeRecipe({
    slug: 'sovereign-ai-india',
    title: 'Sovereign AI India',
    objective: 'Track public signals that change India sovereign-AI strategy, policy, compute access, model programs, or ecosystem timing.',
    description: 'Public signals about India-aligned sovereign AI, policy, infra, and ecosystem moves.',
    keywords: ['india', 'sovereign', 'ai', 'policy', 'compute', 'infra', 'foundation model'],
    seed_queries: [
      'India sovereign AI compute policy foundation model program',
      'IndiaAI mission sovereign AI GPU compute startups model launch',
      'MeitY India AI policy public infrastructure model procurement',
    ],
    watch_entities: ['IndiaAI Mission', 'MeitY', 'CDAC', 'Bhashini', 'Sarvam AI', 'Krutrim', 'NVIDIA India'],
    budgets: { max_queries_per_run: 8, max_results_per_query: 10, max_runtime_seconds: 90, max_external_fetches: 0 },
    outputs: { kinds: ['query_plan', 'claim_candidates', 'radar_candidates'], review_only: true, trusted_world_updates: false },
    action_templates: ['brief the board', 'compare against current stance', 'track for follow-up'],
  }),
  makeRecipe({
    slug: 'agent-memory-systems',
    title: 'Agent Memory Systems',
    objective: 'Track state-of-the-art memory, provenance, recall, context engineering, and evaluation patterns for long-running agents.',
    description: 'Public signals about agent memory systems, evidence-addressable recall, long-context management, and memory evals.',
    keywords: ['agent', 'memory', 'recall', 'context', 'provenance', 'evaluation', 'long running'],
    seed_queries: [
      'AI agent memory systems evidence provenance recall evals',
      'long running agents memory architecture context engineering',
      'agent memory benchmarks source grounded recall',
    ],
    watch_entities: ['OpenAI', 'Anthropic', 'LangChain', 'LlamaIndex', 'Mem0', 'Letta', 'Zep'],
    budgets: { max_queries_per_run: 7, max_results_per_query: 10, max_runtime_seconds: 90, max_external_fetches: 0 },
    outputs: { kinds: ['query_plan', 'claim_candidates', 'briefing_note'], review_only: true, trusted_world_updates: false },
    action_templates: ['capture implementation idea', 'compare to GBrain memory substrate', 'queue for review'],
  }),
  makeRecipe({
    slug: 'ai-agent-infra',
    title: 'AI Agent Infra',
    objective: 'Track agent infrastructure, orchestration, tool-use, evaluation, sandboxing, and deployment patterns that could improve OpenClaw/GBrain.',
    description: 'Public signals about agent infrastructure, orchestration, evals, memory, and tooling.',
    keywords: ['agent', 'orchestration', 'eval', 'tool', 'workflow', 'infra', 'sandbox'],
    seed_queries: [
      'AI agent infrastructure orchestration tool use evals sandbox',
      'production AI agents workflow orchestration deployment monitoring',
      'agent runtime task queue tool calling computer use infrastructure',
    ],
    watch_entities: ['OpenAI Agents SDK', 'Anthropic Claude Code', 'LangGraph', 'CrewAI', 'AutoGen', 'Temporal', 'E2B'],
    budgets: { max_queries_per_run: 8, max_results_per_query: 10, max_runtime_seconds: 90, max_external_fetches: 0 },
    outputs: { kinds: ['query_plan', 'claim_candidates', 'radar_candidates'], review_only: true, trusted_world_updates: false },
    action_templates: ['capture implementation idea', 'compare to current stack', 'queue for review'],
  }),
  makeRecipe({
    slug: 'health-os-personalization',
    title: 'Health OS Personalization',
    objective: 'Track public signals about health operating systems, metabolic personalization, health data interoperability, and evidence-backed personalization loops.',
    description: 'Public signals about personalized health OS products, metabolic health, wearables, GLP-1 programs, Health Connect/Open Health Stack, and evidence-backed personalization.',
    keywords: ['health', 'personalization', 'metabolic', 'wearable', 'glp 1', 'health connect', 'open health stack', 'nutrition'],
    seed_queries: [
      'health OS personalization metabolic wearables GLP-1 evidence backed India',
      'Health Connect Open Health Stack personalized metabolic health app',
      'AI personalized nutrition metabolic health wearable protocols public launch',
    ],
    watch_entities: ['Health Connect', 'Open Health Stack', 'Ultrahuman', 'WHOOP', 'Levels', 'Mochi Health', 'Eli Lilly', 'Novo Nordisk'],
    budgets: { max_queries_per_run: 8, max_results_per_query: 10, max_runtime_seconds: 90, max_external_fetches: 0 },
    outputs: { kinds: ['query_plan', 'claim_candidates', 'radar_candidates', 'briefing_note'], review_only: true, trusted_world_updates: false },
    action_templates: ['compare to Eonic product spine', 'capture product evidence pattern', 'queue for health-trust review'],
  }),
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

function reviewOnlyAction(type: ScoutSuggestedActionType, label: string, rationale: string): ScoutSuggestedAction {
  return { type, label, rationale, review_only: true, external_action_allowed: false, trusted_memory_write_allowed: false };
}

function uniqueActions(actions: ScoutSuggestedAction[]): ScoutSuggestedAction[] {
  const seen = new Set<string>();
  const out: ScoutSuggestedAction[] = [];
  for (const action of actions) {
    const key = `${action.type}:${action.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

function scoreOverlap(haystack: string, needles: string[]): number {
  if (!needles.length) return 0;
  const hay = norm(haystack);
  const hits = needles.filter(n => hay.includes(norm(n)));
  return hits.length / needles.length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringAt(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === 'string' ? String(obj[key]).trim() : undefined;
}

function arrayOfStringsAt(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) return undefined;
  return value.map(v => v.trim());
}

function slugOk(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function validateTopicTrack(track: unknown, path = 'topic_track'): string[] {
  const errors: string[] = [];
  if (!isObject(track)) return [`${path} must be an object`];
  if (track.schema !== 'gbrain.topic_track.v1') errors.push(`${path}.schema must be gbrain.topic_track.v1`);
  const slug = stringAt(track, 'slug');
  if (!slug || !slugOk(slug)) errors.push(`${path}.slug must be kebab-case`);
  for (const key of ['title', 'objective', 'description']) {
    const value = stringAt(track, key);
    if (!value || value.length < (key === 'title' ? 3 : 20)) errors.push(`${path}.${key} must be a substantive string`);
  }
  if (track.namespace !== 'world' && track.namespace !== 'scouts') errors.push(`${path}.namespace must be world or scouts`);
  if (track.privacy !== 'public') errors.push(`${path}.privacy must be public for scout recipes`);
  if (!['daily', 'weekly', 'event_driven'].includes(String(track.cadence))) errors.push(`${path}.cadence must be daily, weekly, or event_driven`);
  const queries = arrayOfStringsAt(track, 'seed_queries');
  if (!queries || queries.length === 0) errors.push(`${path}.seed_queries must be a non-empty string[]`);
  const entities = arrayOfStringsAt(track, 'watch_entities');
  if (!entities || entities.length === 0) errors.push(`${path}.watch_entities must be a non-empty string[]`);
  return errors;
}

export function validateScoutRecipe(recipe: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(recipe)) return ['recipe must be an object'];
  if (recipe.schema !== 'gbrain.scout.recipe.v1') errors.push('schema must be gbrain.scout.recipe.v1');
  const slug = stringAt(recipe, 'slug');
  if (!slug || !slugOk(slug)) errors.push('slug must be kebab-case');
  if (recipe.id !== slug) errors.push('id must equal slug');
  if (recipe.topic !== slug) errors.push('topic must equal slug');
  if (recipe.public !== true) errors.push('public must be true');
  for (const key of ['title', 'objective', 'description']) {
    const value = stringAt(recipe, key);
    if (!value || value.length < (key === 'title' ? 3 : 20)) errors.push(`${key} must be a substantive string`);
  }
  for (const key of ['keywords', 'seed_queries', 'watch_entities', 'action_templates']) {
    const values = arrayOfStringsAt(recipe, key);
    if (!values || values.length === 0) errors.push(`${key} must be a non-empty string[]`);
  }

  const budgets = isObject(recipe.budgets) ? recipe.budgets : null;
  if (!budgets) errors.push('budgets must be an object');
  else {
    for (const key of ['max_queries_per_run', 'max_results_per_query', 'max_runtime_seconds', 'max_external_fetches']) {
      const value = budgets[key];
      if (!Number.isInteger(value) || Number(value) < 0) errors.push(`budgets.${key} must be a non-negative integer`);
    }
    if (Number(budgets.max_queries_per_run) < 1) errors.push('budgets.max_queries_per_run must be at least 1');
    if (Number(budgets.max_results_per_query) < 1) errors.push('budgets.max_results_per_query must be at least 1');
    if (Number(budgets.max_external_fetches) !== 0) errors.push('budgets.max_external_fetches must be 0 for PR19 dry-run recipes');
  }

  const outputs = isObject(recipe.outputs) ? recipe.outputs : null;
  if (!outputs) errors.push('outputs must be an object');
  else {
    const kinds = outputs.kinds;
    if (!Array.isArray(kinds) || kinds.length === 0 || kinds.some(k => !['query_plan', 'claim_candidates', 'radar_candidates', 'briefing_note'].includes(String(k)))) errors.push('outputs.kinds must contain valid output kinds');
    if (outputs.review_only !== true) errors.push('outputs.review_only must be true');
    if (outputs.trusted_world_updates !== false) errors.push('outputs.trusted_world_updates must be false');
  }

  errors.push(...validateTopicTrack(recipe.topic_track));
  if (isObject(recipe.topic_track) && slug && recipe.topic_track.slug !== slug) errors.push('topic_track.slug must equal recipe slug');

  const seedQueries = Array.isArray(recipe.seed_queries) ? recipe.seed_queries.length : 0;
  const maxQueries = isObject(recipe.budgets) && typeof recipe.budgets.max_queries_per_run === 'number' ? recipe.budgets.max_queries_per_run : 0;
  if (seedQueries > 0 && maxQueries > 0 && seedQueries > maxQueries) errors.push('seed_queries length must not exceed budgets.max_queries_per_run');

  return errors;
}

export function validateScoutRecipes(recipes: unknown[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  recipes.forEach((recipe, idx) => {
    const prefix = `recipes[${idx}]`;
    const recipeErrors = validateScoutRecipe(recipe).map(e => `${prefix}.${e}`);
    errors.push(...recipeErrors);
    if (isObject(recipe) && typeof recipe.slug === 'string') {
      if (seen.has(recipe.slug)) errors.push(`${prefix}.slug duplicates another recipe: ${recipe.slug}`);
      seen.add(recipe.slug);
    }
  });
  return errors;
}

export function buildScoutQueryPlan(recipe: ScoutRecipe): ScoutQueryPlan {
  const validationErrors = validateScoutRecipe(recipe);
  if (validationErrors.length) throw new Error(`Invalid scout recipe ${recipe.slug || recipe.id || '<unknown>'}: ${validationErrors.join('; ')}`);
  const rawQueries: ScoutQueryPlanItem[] = [];
  for (const query of recipe.seed_queries) {
    rawQueries.push({
      id: `qry_${stableId({ slug: recipe.slug, query, purpose: 'seed_query' })}`,
      query,
      purpose: 'seed_query',
      watch_entities: recipe.watch_entities.filter(entity => norm(query).includes(norm(entity))).slice(0, 5),
      expected_outputs: recipe.outputs.kinds,
      budget: { max_results_per_query: recipe.budgets.max_results_per_query },
    });
  }
  for (const entity of recipe.watch_entities) {
    rawQueries.push({
      id: `qry_${stableId({ slug: recipe.slug, entity, purpose: 'entity_watch' })}`,
      query: `${entity} ${recipe.keywords.slice(0, 4).join(' ')} latest`,
      purpose: 'entity_watch',
      watch_entities: [entity],
      expected_outputs: recipe.outputs.kinds,
      budget: { max_results_per_query: recipe.budgets.max_results_per_query },
    });
  }
  const queries = rawQueries.slice(0, recipe.budgets.max_queries_per_run);
  return {
    schema: 'gbrain.scout.query_plan.v1',
    mode: 'dry-run',
    fetching_allowed: false,
    recipe_slug: recipe.slug,
    objective: recipe.objective,
    budgets: recipe.budgets,
    query_count: queries.length,
    queries,
    warnings: rawQueries.length > queries.length ? [`query plan capped at budgets.max_queries_per_run=${recipe.budgets.max_queries_per_run}`] : [],
  };
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

  const suggestions = uniqueActions([
    ...(keywordHits > 0.34 ? [reviewOnlyAction('compare', 'compare against current research', 'The signal overlaps the recipe keywords enough to merit a review-only comparison.')] : []),
    ...(novelty >= 0.5 ? [reviewOnlyAction('save_for_review', 'save for review', 'The novelty score is high enough to preserve the signal for reducer/reviewer triage.')] : []),
    ...(urgency >= 0.25 ? [reviewOnlyAction('surface_to_reviewer', 'surface to reviewer', 'The signal has launch/now/timing cues or a dated source, so it should be surfaced for review without external action.')] : []),
    ...recipe.action_templates.slice(0, 2).map(label => reviewOnlyAction('recipe_template', label, `Recipe template action for ${recipe.slug}; review-only and non-mutating.`)),
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
  return BUILTIN_SCOUT_RECIPES.find(r => r.id === id || r.slug === id);
}

export function listTopicTracks(): TopicTrack[] {
  return BUILTIN_SCOUT_RECIPES.map(recipe => recipe.topic_track);
}
