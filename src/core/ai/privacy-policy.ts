import { explainProviderPolicy, fromLegacyAiPrivacyTier, type ProviderPolicyDecision } from '../intelligence/policy.ts';

export const MODEL_PROVIDERS = ['qwen-local', 'minimax-m27', 'codex', 'claude-pro', 'gpt-pro'] as const;
export const PRIVACY_TIERS = ['P0', 'P1', 'P2', 'P3'] as const;
export const WORK_KINDS = ['source_normalize', 'evidence_extract', 'memory_atom_propose', 'claim_support_check', 'query_paraphrase_generate', 'hard_negative_generate', 'world_scout', 'bookmark_enrich', 'opportunity_score', 'code_pr_draft', 'code_pr_review', 'architecture_review'] as const;

export type ModelProvider = typeof MODEL_PROVIDERS[number];
export type PrivacyTier = typeof PRIVACY_TIERS[number];
export type WorkKind = typeof WORK_KINDS[number];

export interface RouteInput {
  kind: WorkKind;
  privacy: PrivacyTier;
  allowCloudEscalation?: boolean;
}

export interface RouteDecision {
  preferred_provider: ModelProvider;
  fallback_providers: ModelProvider[];
  require_json_schema: boolean;
  allow_external_network: boolean;
  allow_raw_private_context: boolean;
  max_context_tokens?: number;
  warnings: string[];
}

const CLOUD: ModelProvider[] = ['minimax-m27', 'codex', 'claude-pro', 'gpt-pro'];

export function canSendLegacyPrivacyToProvider(privacy: PrivacyTier, provider: string, sanitized: boolean): ProviderPolicyDecision {
  return explainProviderPolicy(fromLegacyAiPrivacyTier(privacy), provider, sanitized);
}

export function assertRouteAllowed(route: RouteDecision, input: RouteInput): void {
  if (input.privacy === 'P0') {
    const providers = [route.preferred_provider, ...route.fallback_providers];
    if (providers.some(p => p !== 'qwen-local')) throw new Error('P0 cannot route to cloud providers');
  }
  if (input.privacy === 'P1' && route.allow_raw_private_context) {
    throw new Error('P1 routes must not allow raw private context');
  }
  if ((route.allow_external_network || route.preferred_provider !== 'qwen-local' || route.fallback_providers.some(p => CLOUD.includes(p))) && input.privacy === 'P0') {
    throw new Error('P0 cannot use cloud routing');
  }

  const providers = [route.preferred_provider, ...route.fallback_providers];
  const sanitized = !route.allow_raw_private_context;
  for (const provider of providers) {
    const decision = canSendLegacyPrivacyToProvider(input.privacy, provider, sanitized);
    if (!decision.ok) throw new Error(`provider policy denied: ${decision.reason}`);
  }
}

export function redactRoutePrompt(prompt: string, privacy: PrivacyTier): string {
  if (privacy === 'P0' || privacy === 'P1') return '[redacted-private-context]';
  return prompt.slice(0, 4000);
}

export function summarizeRoutePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}
