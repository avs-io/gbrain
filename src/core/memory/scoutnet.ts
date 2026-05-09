import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  classifyNamespacePolicy,
  validateNamespacePolicy,
  type GBrainNamespace,
  type GBrainPrivacy,
  type GBrainSensitivity,
} from './namespace-policy.ts';

export const SCOUT_RECIPE_SCHEMA = 'gbrain.scout.recipe.v1';
export const SCOUT_OBSERVATION_SCHEMA = 'gbrain.scout.observation.v1';
export const SCOUT_COVERAGE_REPORT_SCHEMA = 'gbrain.scout.coverage_report.v1';

export type ScoutNextActionType = 'monitor' | 'research' | 'brief' | 'ignore' | 'proposal';

export interface ScoutRecipeSource {
  id: string;
  name: string;
  kind: 'official_site' | 'official_doc' | 'procurement_portal' | 'news' | 'research' | 'local_report' | 'other';
  url?: string;
  check_mode: 'manual' | 'local_sample' | 'future_live_fetch';
  priority: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface ScoutRecipe {
  schema: typeof SCOUT_RECIPE_SCHEMA;
  id: string;
  title: string;
  topic: string;
  description?: string;
  default_policy: {
    namespace: GBrainNamespace;
    privacy: GBrainPrivacy;
    sensitivity: GBrainSensitivity;
  };
  cadence: {
    freshness_window_days: number;
    dry_run_only_until_review: true;
  };
  sources: ScoutRecipeSource[];
  queries: string[];
  blind_spots?: string[];
  failure_policy: {
    live_web_crawl_allowed: false;
    trusted_world_model_updates_allowed: false;
    external_actions_allowed: false;
  };
}

export interface ScoutObservation {
  schema: typeof SCOUT_OBSERVATION_SCHEMA;
  id: string;
  recipe_id: string;
  observed_at: string;
  namespace: GBrainNamespace;
  privacy: GBrainPrivacy;
  sensitivity: GBrainSensitivity;
  status: 'proposed';
  source: {
    source_id: string;
    name: string;
    kind: ScoutRecipeSource['kind'];
    url?: string;
    title?: string;
    published_at?: string;
    retrieved_at?: string;
    citation: string;
    citation_url?: string;
  };
  coverage: {
    query: string;
    checked_at: string;
    freshness_window_days: number;
    method: 'local_sample' | 'manual_note' | 'future_live_fetch';
  };
  signal: {
    summary: string;
    quote?: string;
    novelty: number;
    relevance: number;
    confidence: number;
  };
  recommended_next_action: {
    type: ScoutNextActionType;
    rationale: string;
    owner?: string;
  };
  guardrails: {
    observation_is_proposal: true;
    trusted_world_model_updated: false;
    trusted_pages_edited: false;
    external_messages_sent: false;
    live_web_crawl_performed: false;
  };
}

export interface ScoutCoverageReport {
  schema: typeof SCOUT_COVERAGE_REPORT_SCHEMA;
  recipe_id: string;
  generated_at: string;
  dry_run: true;
  freshness_window: {
    days: number;
    started_at?: string;
    ended_at: string;
  };
  sources_checked: Array<{ id: string; name: string; kind: string; checked_at: string; observations: number }>;
  sources_not_checked: Array<{ id: string; name: string; kind: string; reason: string }>;
  queries: string[];
  blind_spots: string[];
  failures: Array<{ source_id?: string; message: string }>;
  guardrails: {
    trusted_world_model_updated: false;
    trusted_pages_edited: false;
    external_messages_sent: false;
    live_web_crawl_performed: false;
  };
}

export interface ScoutDryRunResult {
  ok: boolean;
  action: 'scout-dry-run';
  recipe: ScoutRecipe;
  observations: ScoutObservation[];
  proposals: ScoutObservation[];
  coverage_report: ScoutCoverageReport;
  errors: string[];
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isIsoLike(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function validScore(value: unknown): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function validateString(value: unknown, label: string, errors: string[], min = 1): void {
  if (typeof value !== 'string' || value.trim().length < min) errors.push(`${label} must be a non-empty string`);
}

export function loadJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function observationIdFor(input: { recipeId: string; sourceId: string; summary: string; observedAt?: string }): string {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12);
  return `scout_obs_${hash}`;
}

export function scoutDefaultsFor(recipe?: Partial<ScoutRecipe>): { namespace: GBrainNamespace; privacy: GBrainPrivacy; sensitivity: GBrainSensitivity } {
  return {
    namespace: recipe?.default_policy?.namespace || 'scouts',
    privacy: recipe?.default_policy?.privacy || 'internal',
    sensitivity: recipe?.default_policy?.sensitivity || 'medium',
  };
}

export function validateScoutRecipe(recipe: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(recipe)) return ['recipe must be a JSON object'];
  if (recipe.schema !== SCOUT_RECIPE_SCHEMA) errors.push(`schema must be ${SCOUT_RECIPE_SCHEMA}`);
  validateString(recipe.id, 'id', errors, 3);
  validateString(recipe.title, 'title', errors, 3);
  validateString(recipe.topic, 'topic', errors, 3);
  errors.push(...validateNamespacePolicy(recipe.default_policy || scoutDefaultsFor()));
  if (recipe.default_policy) {
    const p = recipe.default_policy;
    if (p.namespace !== 'scouts' && p.namespace !== 'world') errors.push('default_policy.namespace for scout recipes must be scouts or world');
    if (p.privacy !== 'public' && p.privacy !== 'internal') errors.push('default_policy.privacy for scout recipes must be public or internal');
    if (p.sensitivity !== 'low' && p.sensitivity !== 'medium') errors.push('default_policy.sensitivity should be low or medium unless an observation is explicitly flagged');
  }
  const cadence = isObject(recipe.cadence) ? recipe.cadence : null;
  if (!cadence) errors.push('cadence is required');
  else {
    if (typeof cadence.freshness_window_days !== 'number' || cadence.freshness_window_days < 1) errors.push('cadence.freshness_window_days must be a positive number');
    if (cadence.dry_run_only_until_review !== true) errors.push('cadence.dry_run_only_until_review must be true');
  }
  if (!Array.isArray(recipe.sources) || recipe.sources.length === 0) errors.push('sources must include at least one source');
  else {
    const ids = new Set<string>();
    recipe.sources.forEach((source: unknown, idx: number) => {
      const prefix = `sources[${idx}]`;
      if (!isObject(source)) return errors.push(`${prefix} must be an object`);
      validateString(source.id, `${prefix}.id`, errors, 2);
      validateString(source.name, `${prefix}.name`, errors, 2);
      if (typeof source.id === 'string') {
        if (ids.has(source.id)) errors.push(`${prefix}.id duplicate: ${source.id}`);
        ids.add(source.id);
      }
      if (!['official_site', 'official_doc', 'procurement_portal', 'news', 'research', 'local_report', 'other'].includes(source.kind)) errors.push(`${prefix}.kind is invalid`);
      if (!['manual', 'local_sample', 'future_live_fetch'].includes(source.check_mode)) errors.push(`${prefix}.check_mode is invalid`);
      if (!['high', 'medium', 'low'].includes(source.priority)) errors.push(`${prefix}.priority is invalid`);
    });
  }
  if (!Array.isArray(recipe.queries) || recipe.queries.length === 0) errors.push('queries must include at least one query');
  const failure = isObject(recipe.failure_policy) ? recipe.failure_policy : null;
  if (!failure) errors.push('failure_policy is required');
  else {
    if (failure.live_web_crawl_allowed !== false) errors.push('failure_policy.live_web_crawl_allowed must be false');
    if (failure.trusted_world_model_updates_allowed !== false) errors.push('failure_policy.trusted_world_model_updates_allowed must be false');
    if (failure.external_actions_allowed !== false) errors.push('failure_policy.external_actions_allowed must be false');
  }
  return errors;
}

export function validateScoutObservation(observation: unknown, recipe?: ScoutRecipe): string[] {
  const errors: string[] = [];
  if (!isObject(observation)) return ['observation must be a JSON object'];
  if (observation.schema !== SCOUT_OBSERVATION_SCHEMA) errors.push(`schema must be ${SCOUT_OBSERVATION_SCHEMA}`);
  validateString(observation.id, 'id', errors, 6);
  if (typeof observation.id === 'string' && !observation.id.startsWith('scout_obs_')) errors.push('id must start with scout_obs_');
  validateString(observation.recipe_id, 'recipe_id', errors, 3);
  if (recipe && observation.recipe_id !== recipe.id) errors.push(`recipe_id must match recipe id ${recipe.id}`);
  if (!isIsoLike(observation.observed_at)) errors.push('observed_at must be ISO-like');
  errors.push(...validateNamespacePolicy({ namespace: observation.namespace, privacy: observation.privacy, sensitivity: observation.sensitivity }));
  if (observation.namespace !== 'scouts' && observation.namespace !== 'world') errors.push('observation namespace must be scouts or world');
  if (observation.privacy !== 'public' && observation.privacy !== 'internal') errors.push('observation privacy must be public or internal unless flagged into another governed lane');
  if (observation.status !== 'proposed') errors.push('status must be proposed; ScoutNet cannot create trusted world-model updates');
  const source = isObject(observation.source) ? observation.source : null;
  if (!source) errors.push('source is required');
  else {
    validateString(source.source_id, 'source.source_id', errors, 2);
    validateString(source.name, 'source.name', errors, 2);
    validateString(source.citation, 'source.citation', errors, 5);
    if (source.published_at !== undefined && !isIsoLike(source.published_at)) errors.push('source.published_at must be ISO-like when present');
    if (source.retrieved_at !== undefined && !isIsoLike(source.retrieved_at)) errors.push('source.retrieved_at must be ISO-like when present');
    if (recipe && typeof source.source_id === 'string' && !recipe.sources.some(s => s.id === source.source_id)) errors.push(`source.source_id not present in recipe: ${source.source_id}`);
  }
  const coverage = isObject(observation.coverage) ? observation.coverage : null;
  if (!coverage) errors.push('coverage is required');
  else {
    validateString(coverage.query, 'coverage.query', errors, 3);
    if (!isIsoLike(coverage.checked_at)) errors.push('coverage.checked_at must be ISO-like');
    if (typeof coverage.freshness_window_days !== 'number' || coverage.freshness_window_days < 1) errors.push('coverage.freshness_window_days must be a positive number');
    if (!['local_sample', 'manual_note', 'future_live_fetch'].includes(coverage.method)) errors.push('coverage.method is invalid');
    if (coverage.method === 'future_live_fetch') errors.push('coverage.method=future_live_fetch is not allowed in dry-run observations');
  }
  const signal = isObject(observation.signal) ? observation.signal : null;
  if (!signal) errors.push('signal is required');
  else {
    validateString(signal.summary, 'signal.summary', errors, 10);
    if (!validScore(signal.novelty)) errors.push('signal.novelty must be between 0 and 1');
    if (!validScore(signal.relevance)) errors.push('signal.relevance must be between 0 and 1');
    if (!validScore(signal.confidence)) errors.push('signal.confidence must be between 0 and 1');
  }
  const next = isObject(observation.recommended_next_action) ? observation.recommended_next_action : null;
  if (!next) errors.push('recommended_next_action is required');
  else {
    if (!['monitor', 'research', 'brief', 'ignore', 'proposal'].includes(next.type)) errors.push('recommended_next_action.type is invalid');
    validateString(next.rationale, 'recommended_next_action.rationale', errors, 5);
  }
  const guardrails = isObject(observation.guardrails) ? observation.guardrails : null;
  if (!guardrails) errors.push('guardrails are required');
  else {
    if (guardrails.observation_is_proposal !== true) errors.push('guardrails.observation_is_proposal must be true');
    if (guardrails.trusted_world_model_updated !== false) errors.push('guardrails.trusted_world_model_updated must be false');
    if (guardrails.trusted_pages_edited !== false) errors.push('guardrails.trusted_pages_edited must be false');
    if (guardrails.external_messages_sent !== false) errors.push('guardrails.external_messages_sent must be false');
    if (guardrails.live_web_crawl_performed !== false) errors.push('guardrails.live_web_crawl_performed must be false');
  }
  try {
    classifyNamespacePolicy({ namespace: observation.namespace, privacy: observation.privacy, sensitivity: observation.sensitivity });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return errors;
}

export function buildScoutCoverageReport(recipe: ScoutRecipe, observations: ScoutObservation[], opts: { now?: Date; failures?: Array<{ source_id?: string; message: string }> } = {}): ScoutCoverageReport {
  const now = opts.now || new Date();
  const bySource = new Map<string, ScoutObservation[]>();
  for (const observation of observations) {
    const arr = bySource.get(observation.source.source_id) || [];
    arr.push(observation);
    bySource.set(observation.source.source_id, arr);
  }
  return {
    schema: SCOUT_COVERAGE_REPORT_SCHEMA,
    recipe_id: recipe.id,
    generated_at: now.toISOString(),
    dry_run: true,
    freshness_window: {
      days: recipe.cadence.freshness_window_days,
      ended_at: now.toISOString(),
    },
    sources_checked: recipe.sources.filter(s => bySource.has(s.id)).map(source => {
      const rows = bySource.get(source.id) || [];
      return {
        id: source.id,
        name: source.name,
        kind: source.kind,
        checked_at: rows.map(r => r.coverage.checked_at).sort().at(-1) || now.toISOString(),
        observations: rows.length,
      };
    }),
    sources_not_checked: recipe.sources.filter(s => !bySource.has(s.id)).map(source => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      reason: source.check_mode === 'future_live_fetch' ? 'live fetch disabled in PR6 dry-run substrate' : 'no local sample observation supplied',
    })),
    queries: recipe.queries,
    blind_spots: recipe.blind_spots || [],
    failures: opts.failures || [],
    guardrails: {
      trusted_world_model_updated: false,
      trusted_pages_edited: false,
      external_messages_sent: false,
      live_web_crawl_performed: false,
    },
  };
}

export function runScoutDryRun(input: { recipe: unknown; observations: unknown[]; now?: Date }): ScoutDryRunResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipeErrors = validateScoutRecipe(input.recipe);
  if (recipeErrors.length) {
    const fallbackRecipe = input.recipe as ScoutRecipe;
    return {
      ok: false,
      action: 'scout-dry-run',
      recipe: fallbackRecipe,
      observations: [],
      proposals: [],
      coverage_report: buildScoutCoverageReport({
        schema: SCOUT_RECIPE_SCHEMA,
        id: isObject(input.recipe) && typeof input.recipe.id === 'string' ? input.recipe.id : 'invalid-recipe',
        title: 'Invalid recipe',
        topic: 'invalid',
        default_policy: scoutDefaultsFor(),
        cadence: { freshness_window_days: 1, dry_run_only_until_review: true },
        sources: [],
        queries: [],
        failure_policy: { live_web_crawl_allowed: false, trusted_world_model_updates_allowed: false, external_actions_allowed: false },
      }, [], { now: input.now, failures: recipeErrors.map(message => ({ message })) }),
      errors: recipeErrors,
      warnings,
    };
  }
  const recipe = input.recipe as ScoutRecipe;
  const observations = input.observations as ScoutObservation[];
  observations.forEach((observation, idx) => {
    const obsErrors = validateScoutObservation(observation, recipe);
    errors.push(...obsErrors.map(e => `observations[${idx}]: ${e}`));
  });
  const accepted = errors.length ? [] : observations;
  const proposals = accepted.filter(o => o.recommended_next_action.type !== 'ignore');
  if (!accepted.length && !errors.length) warnings.push('no local observations supplied; coverage report will show all sources unchecked');
  const coverage_report = buildScoutCoverageReport(recipe, accepted, { now: input.now });
  return { ok: errors.length === 0, action: 'scout-dry-run', recipe, observations: accepted, proposals, coverage_report, errors, warnings };
}

export function loadScoutInputs(recipePath: string, observationsPath?: string): { recipe: unknown; observations: unknown[] } {
  const recipe = loadJsonFile(recipePath);
  if (!observationsPath) return { recipe, observations: [] };
  const raw = loadJsonFile(observationsPath);
  if (Array.isArray(raw)) return { recipe, observations: raw };
  if (isObject(raw) && Array.isArray(raw.observations)) return { recipe, observations: raw.observations };
  throw new Error(`${basename(observationsPath)} must be an array or object with observations[]`);
}
