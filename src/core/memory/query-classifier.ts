/**
 * Query/Context Classifier — PR9
 *
 * Classifies incoming queries into intent categories and produces
 * memory-type routing decisions without relying on the typed-memory
 * fixture store. This is the missing "intent + memory-type router"
 * layer that sits between raw query and the typed-memory router.
 *
 * Usage:
 *   classifyQuery(query, context?) → QueryClassification
 *
 * The classifier is deterministic, local, and produces structured
 * output that can be consumed by:
 *   - recallEvidence() for evidence recall with routing hints
 *   - routeTypedMemory() for typed-memory lookups
 *   - reflection module for proactive surfacing decisions
 *   - radar module for scoring decisions
 */

import { TYPED_MEMORY_ROUTES, detectTypedMemoryRoutes } from './typed-memory-router.ts';
import type { TypedMemoryRoute, TypedMemoryRouteResult } from './types.ts';

// ── Intent categories ──────────────────────────────────────────

export type QueryIntent =
  | 'historical_arc'
  | 'current_vs_historical_truth'
  | 'relationship_open_loop'
  | 'preference_opportunity'
  | 'procedure_governance'
  | 'native_integration_design'
  | 'general_recall'
  | 'proactive_surfacing'
  | 'abstain';

export type QueryClassification = {
  intent: QueryIntent;
  confidence: number; // 0-1
  memory_types: string[];
  entities: string[];
  tags: string[];
  matched_route_ids: string[];
  is_proactive: boolean;
  needs_context: boolean;
  routing_hint?: string; // route ID for typed-memory router
};

// ── Context signals ────────────────────────────────────────────

export type ContextSignal = {
  workstream?: string;
  current_focus?: string;
  active_projects?: string[];
  recent_queries?: string[];
  time_sensitivity?: 'none' | 'low' | 'medium' | 'high';
  interruption_cost?: 'none' | 'low' | 'medium' | 'high';
};

// ── Keyword lexicon ────────────────────────────────────────────

const HISTORICAL_ARC_TERMS = new Set([
  'citadel', 'sovereign cognition', 'cognitive fortress', 'post-human',
  'human+ai', 'root-stock', 'anti-programming', 'programmable drift',
  'initial idea', 'why moved', 'why moved away', 'evolution', 'lineage',
  'what was', 'what led', 'what caused', 'history', 'historical',
  'back then', 'originally', 'initially', 'started as',
]);

const CURRENT_VS_HISTORICAL_TERMS = new Set([
  'sovereign ai', 'primary focus', 'primary current', 'eonic',
  'procurement', 'productized pilot', 'consulting-led', 'stale',
  'superseded', 'current truth', 'historical truth', 'now', 'currently',
  'changed', 'pivot', 'moved away', 'moved on', 'posture',
  'what changed', 'why changed', 'current status',
]);

const RELATIONSHIP_TERMS = new Set([
  'somnath', 's. krishnan', 'e-committee', 'ecommittee', 'bharatgen',
  'gem', 'government outreach', 'judicial ai', 'sovereign ai pilot',
  'archana', 'rukam', 'relationship', 'contact', 'person', 'people',
  'open loop', 'open-loop', 'follow up', 'follow-up', 'outreach',
  'reached out', 'connection', 'relationship with',
]);

const PREFERENCE_OPPORTUNITY_TERMS = new Set([
  'mlx', 'local model', 'local models', 'qwen', 'qwen2.5',
  'worker lane', 'bounded worker', 'model routing', 'm3 ultra',
  'preference', 'preference signal', 'local compute', 'local model',
  'hobby', 'pet project', 'deferred', 'later', 'someday', 'bookmark',
  'bookmarked', 'save for later', 'interesting', 'nice to have',
  'when i have time', 'someday maybe',
]);

const PROCEDURE_GOVERNANCE_TERMS = new Set([
  'trusted write', 'writeback', 'write-back', 'propose-memory',
  'trusted brain', 'brain pages', 'direct edit', 'governed proposal',
  'governed', 'proposal', 'review', 'approval', 'write-back',
  'governed write', 'governed write-back', 'governed proposal',
  'governed writeback',
]);

const NATIVE_INTEGRATION_TERMS = new Set([
  'typed memory', 'typed-memory', 'memory products', 'living-memory substrate',
  'native gbrain', 'memory substrate', 'integrating native gbrain',
  'schema', 'jsonl', 'typed memory router', 'memory router',
]);

const PROACTIVE_SURFACING_TERMS = new Set([
  'proactive', 'surfacing', 'surface', 'suggest', 'recommend',
  'relevant', 'old memory', 'old relevant', 'context match',
  'on context', 'on query', 'interruption cost', 'annoyance budget',
  'proactive candidate', 'proactive surfacing',
]);

// ── Classification logic ───────────────────────────────────────

function scoreCategory(text: string, terms: Set<string>): number {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(t => t.length >= 1);
  let score = 0;
  for (const term of terms) {
    const termLower = term.toLowerCase();
    // Multi-word terms: check if all tokens appear in sequence
    const termTokens = termLower.split(/\s+/);
    if (termTokens.length > 1) {
      // Multi-word: check if the full term appears as substring
      if (lower.includes(termLower)) {
        score += Math.max(3, termTokens.length + 2);
      }
    } else {
      // Single-word: check if the token matches exactly (not as substring)
      if (tokens.includes(termLower)) {
        score += Math.max(2, 1);
      }
      // Also check if concatenated adjacent tokens match hyphenated terms
      // e.g., "e-committee" → tokens ["e", "committee"] → "ecommittee"
      for (let i = 0; i < tokens.length - 1; i++) {
        const concat = tokens[i] + tokens[i + 1];
        // Direct match (e.g., "ecommittee" === "ecommittee")
        if (concat === termLower) {
          score += Math.max(2, 1);
          break;
        }
        // Hyphenated term: strip hyphens from term and compare
        const termNoHyphen = termLower.replace(/-/g, '');
        if (concat === termNoHyphen) {
          score += Math.max(2, 1);
          break;
        }
      }
    }
  }
  return score;
}

function classifyByIntent(text: string): { intent: QueryIntent; score: number; routeId?: string } {
  const categories: { intent: QueryIntent; score: number; routeId?: string }[] = [];

  // Historical arc
  const histScore = scoreCategory(text, HISTORICAL_ARC_TERMS);
  if (histScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'citadel-lineage');
    categories.push({ intent: 'historical_arc', score: histScore, routeId: route?.id });
  }

  // Current vs historical
  const cvhScore = scoreCategory(text, CURRENT_VS_HISTORICAL_TERMS);
  if (cvhScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'sovereign-ai-strategy-pivot');
    categories.push({ intent: 'current_vs_historical_truth', score: cvhScore, routeId: route?.id });
  }

  // Relationship
  const relScore = scoreCategory(text, RELATIONSHIP_TERMS);
  if (relScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'government-outreach');
    categories.push({ intent: 'relationship_open_loop', score: relScore, routeId: route?.id });
  }

  // Preference / opportunity
  const prefScore = scoreCategory(text, PREFERENCE_OPPORTUNITY_TERMS);
  if (prefScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'local-model-worker-lane');
    categories.push({ intent: 'preference_opportunity', score: prefScore, routeId: route?.id });
  }

  // Procedure / governance
  const procScore = scoreCategory(text, PROCEDURE_GOVERNANCE_TERMS);
  if (procScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'trusted-writeback');
    categories.push({ intent: 'procedure_governance', score: procScore, routeId: route?.id });
  }

  // Native integration
  const natScore = scoreCategory(text, NATIVE_INTEGRATION_TERMS);
  if (natScore > 0) {
    const route = TYPED_MEMORY_ROUTES.find(r => r.id === 'typed-memory-integration');
    categories.push({ intent: 'native_integration_design', score: natScore, routeId: route?.id });
  }

  // Proactive surfacing
  const progScore = scoreCategory(text, PROACTIVE_SURFACING_TERMS);
  if (progScore > 0) {
    categories.push({ intent: 'proactive_surfacing', score: progScore });
  }

  // Sort by score descending
  categories.sort((a, b) => b.score - a.score);

  if (categories.length === 0) {
    return { intent: 'general_recall', score: 0 };
  }

  return categories[0];
}

// ── Entity extraction (lightweight) ────────────────────────────

function extractEntities(text: string): string[] {
  const lower = text.toLowerCase();
  const entities: string[] = [];

  // Known entity patterns
  const knownEntities = [
    'citadel', 'sovereign cognition', 'cognitive fortress', 'post-human',
    'human+ai', 'sovereign ai', 'eonic', 'bharatgen', 'gem',
    'somnath', 's. krishnan', 'e-committee', 'ecommittee',
    'archana', 'rukam', 'mlx', 'qwen', 'qwen2.5', 'm3 ultra',
    'gbrain', 'chief', 'claw', 'world 8', 'verdict',
  ];

  for (const entity of knownEntities) {
    if (lower.includes(entity)) {
      entities.push(entity);
    }
  }

  return entities;
}

// ── Tag extraction (lightweight) ───────────────────────────────

function extractTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];

  const tagPatterns: [string, string][] = [
    ['history', 'historical'],
    ['current', 'current'],
    ['people', 'relationship'],
    ['preference', 'preference'],
    ['opportunity', 'opportunity'],
    ['procedure', 'procedure'],
    ['governance', 'governance'],
    ['integration', 'integration'],
    ['surfacing', 'proactive'],
  ];

  for (const [pattern, tag] of tagPatterns) {
    if (lower.includes(pattern)) {
      tags.push(tag);
    }
  }

  return tags;
}

// ── Main classifier ────────────────────────────────────────────

/**
 * Classify a raw query string into an intent category with routing hints.
 *
 * When `context` is provided, the classifier also considers:
 * - Active workstream context for proactive surfacing decisions
 * - Time sensitivity for interruption-cost gating
 * - Whether the query is a recall vs. a proactive surfacing request
 *
 * Returns a QueryClassification that can be consumed by:
 * - recallEvidence() for evidence recall with routing hints
 * - routeTypedMemory() for typed-memory lookups
 * - reflection module for proactive surfacing decisions
 */
export function classifyQuery(
  query: string,
  context?: string | ContextSignal,
): QueryClassification {
  const queryText = query || '';
  const contextText = typeof context === 'string' ? context : '';
  const combined = [queryText, contextText].filter(Boolean).join('\n');

  // Classify by intent
  const { intent, score, routeId } = classifyByIntent(combined);

  // Extract entities and tags
  const entities = extractEntities(combined);
  const tags = extractTags(combined);

  // Determine memory types from matched route
  const matchedRoute = routeId
    ? TYPED_MEMORY_ROUTES.find(r => r.id === routeId)
    : undefined;
  const memoryTypes = matchedRoute?.types || [];

  // Determine matched route IDs:
  // 1. Routes that directly match the query text (via route terms)
  // 2. Routes that correspond to the classified intent (via intent→route mapping)
  const intentToRouteId: Record<string, string> = {
    historical_arc: 'citadel-lineage',
    current_vs_historical_truth: 'sovereign-ai-strategy-pivot',
    relationship_open_loop: 'government-outreach',
    preference_opportunity: 'local-model-worker-lane',
    procedure_governance: 'trusted-writeback',
    native_integration_design: 'typed-memory-integration',
  };

  const directMatchIds = TYPED_MEMORY_ROUTES
    .filter(r => scoreCategory(combined, new Set(r.terms)) > 0)
    .map(r => r.id);

  // Add the route corresponding to the classified intent
  const intentRouteId = intentToRouteId[intent];
  const matchedRouteIds = intentRouteId
    ? [...new Set([...directMatchIds, intentRouteId])]
    : directMatchIds;

  // Proactive detection
  const isProactive = intent === 'proactive_surfacing' ||
    (matchedRouteIds.includes('citadel-lineage') &&
      scoreCategory(queryText, PROACTIVE_SURFACING_TERMS) > 0);

  // Needs context: some intents benefit from context signals
  const needsContext = intent === 'proactive_surfacing' ||
    intent === 'preference_opportunity' ||
    intent === 'relationship_open_loop';

  // Confidence: based on score relative to max possible
  const maxPossible = 20; // rough upper bound for a well-matched query
  const confidence = Math.min(1, score / maxPossible);

  // Routing hint for typed-memory router
  const routingHint = routeId || (matchedRouteIds.length > 0 ? matchedRouteIds[0] : undefined);

  return {
    intent,
    confidence,
    memory_types: memoryTypes,
    entities,
    tags,
    matched_route_ids: matchedRouteIds,
    is_proactive: isProactive,
    needs_context: needsContext,
    routing_hint: routingHint,
  };
}

// ── Convenience: classify + route in one call ──────────────────

/**
 * Classify a query and immediately produce a routing decision
 * suitable for feeding into routeTypedMemory().
 *
 * This is the "intent + memory-type router" that MEMORY.md calls out
 * as the next major target.
 */
export function classifyAndRoute(
  query: string,
  context?: string | ContextSignal,
): { classification: QueryClassification; routingHint: string | undefined; memoryTypes: string[] } {
  const classification = classifyQuery(query, context);
  return {
    classification,
    routingHint: classification.routing_hint,
    memoryTypes: classification.memory_types,
  };
}

// ── Integration: produce a TypedMemoryRouteResult-compatible hint ─

/**
 * Produce a minimal TypedMemoryRouteResult from a classification,
 * suitable for feeding into routeTypedMemory() as a pre-filter.
 */
export function classificationToRouteHint(classification: QueryClassification): {
  matched_routes: TypedMemoryRouteResult['matched_routes'];
  desired_memory_types: string[];
  desired_entities: string[];
} {
  const matchedRoutes = classification.matched_route_ids
    .map(id => TYPED_MEMORY_ROUTES.find(r => r.id === id))
    .filter(Boolean) as TypedMemoryRoute[];

  return {
    matched_routes: matchedRoutes.map(r => ({
      id: r.id,
      label: r.label,
      intent: r.intent,
      score: 0, // classification handles scoring
      hits: [],
    })),
    desired_memory_types: classification.memory_types,
    desired_entities: classification.entities,
  };
}
