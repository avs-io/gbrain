export const NAMESPACES = ['personal', 'project', 'network', 'world', 'operational', 'synthetic'] as const;
export const PRIVACY_TIERS = ['P0_LOCAL_ONLY', 'P1_PRIVATE', 'P2_LIMITED_CLOUD', 'P3_PUBLIC'] as const;
export const AUTHORITY_TIERS = ['raw_source', 'source_span', 'observation', 'claim', 'accepted_memory', 'compiled_surface', 'recommendation', 'action_proposal', 'executed_action'] as const;
export const SUPPORT_LEVELS = ['direct_quote', 'strong_inference', 'weak_inference', 'unsupported', 'contradicted'] as const;
export const FRESHNESS_POLICY_MODES = ['static', 'slow_decay', 'fast_decay', 'expires', 'must_refresh_before_use'] as const;

export type Namespace = typeof NAMESPACES[number];
export type PrivacyTier = typeof PRIVACY_TIERS[number];
export type AuthorityTier = typeof AUTHORITY_TIERS[number];
export type SupportLevel = typeof SUPPORT_LEVELS[number];
export type FreshnessPolicyMode = typeof FRESHNESS_POLICY_MODES[number];

export type FreshnessPolicy = {
  mode: FreshnessPolicyMode;
  ttlHours?: number;
  staleAfter?: string;
};

export type LegacyAiPrivacyTier = 'P0' | 'P1' | 'P2' | 'P3';

export type ProviderPolicyDecision = {
  ok: boolean;
  reason: string;
  provider: string;
  privacyTier: PrivacyTier;
  sanitized: boolean;
};

const LOCAL_PROVIDERS = new Set(['qwen-local', 'mlx', 'mlxthink', 'ollama']);
const CLOUD_PROVIDERS = new Set(['minimax-m27', 'minimax', 'codex', 'claude-pro', 'gpt-pro', 'openai-codex', 'openai', 'anthropic']);

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isNamespace(value: unknown): value is Namespace {
  return includes(NAMESPACES, value);
}

export function isPrivacyTier(value: unknown): value is PrivacyTier {
  return includes(PRIVACY_TIERS, value);
}

export function isAuthorityTier(value: unknown): value is AuthorityTier {
  return includes(AUTHORITY_TIERS, value);
}

export function toLegacyAiPrivacyTier(privacyTier: PrivacyTier): LegacyAiPrivacyTier {
  switch (privacyTier) {
    case 'P0_LOCAL_ONLY': return 'P0';
    case 'P1_PRIVATE': return 'P1';
    case 'P2_LIMITED_CLOUD': return 'P2';
    case 'P3_PUBLIC': return 'P3';
  }
}

export function fromLegacyAiPrivacyTier(privacyTier: LegacyAiPrivacyTier): PrivacyTier {
  switch (privacyTier) {
    case 'P0': return 'P0_LOCAL_ONLY';
    case 'P1': return 'P1_PRIVATE';
    case 'P2': return 'P2_LIMITED_CLOUD';
    case 'P3': return 'P3_PUBLIC';
  }
}

export function explainProviderPolicy(inputPrivacyTier: PrivacyTier, provider: string, sanitized: boolean): ProviderPolicyDecision {
  if (!isPrivacyTier(inputPrivacyTier)) {
    return { ok: false, reason: `unknown privacy tier: ${String(inputPrivacyTier)}`, provider, privacyTier: inputPrivacyTier, sanitized };
  }

  if (LOCAL_PROVIDERS.has(provider)) {
    return { ok: true, reason: 'local provider allowed for all privacy tiers', provider, privacyTier: inputPrivacyTier, sanitized };
  }

  if (!CLOUD_PROVIDERS.has(provider)) {
    return { ok: false, reason: `unknown provider: ${provider}`, provider, privacyTier: inputPrivacyTier, sanitized };
  }

  if (inputPrivacyTier === 'P0_LOCAL_ONLY') {
    return { ok: false, reason: 'P0_LOCAL_ONLY cannot be sent to cloud providers', provider, privacyTier: inputPrivacyTier, sanitized };
  }

  if (inputPrivacyTier === 'P1_PRIVATE' && !sanitized) {
    return { ok: false, reason: 'P1_PRIVATE requires sanitized context before cloud provider use', provider, privacyTier: inputPrivacyTier, sanitized };
  }

  return { ok: true, reason: `${inputPrivacyTier} is allowed for provider ${provider}${sanitized ? ' with sanitized context' : ''}`, provider, privacyTier: inputPrivacyTier, sanitized };
}

export function canSendToProvider(inputPrivacyTier: PrivacyTier, provider: string, sanitized: boolean): boolean {
  return explainProviderPolicy(inputPrivacyTier, provider, sanitized).ok;
}
