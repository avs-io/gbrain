import { describe, expect, test } from 'bun:test';
import { canSendToProvider, explainProviderPolicy, fromLegacyAiPrivacyTier, isAuthorityTier, isNamespace, isPrivacyTier, toLegacyAiPrivacyTier } from '../../src/core/intelligence/policy.ts';

describe('intelligence substrate policy', () => {
  test('validates canonical namespace/privacy/authority values', () => {
    expect(isNamespace('personal')).toBe(true);
    expect(isNamespace('random')).toBe(false);
    expect(isPrivacyTier('P0_LOCAL_ONLY')).toBe(true);
    expect(isPrivacyTier('P0')).toBe(false);
    expect(isAuthorityTier('source_span')).toBe(true);
  });

  test('adapts legacy AI privacy tiers', () => {
    expect(toLegacyAiPrivacyTier('P0_LOCAL_ONLY')).toBe('P0');
    expect(fromLegacyAiPrivacyTier('P2')).toBe('P2_LIMITED_CLOUD');
  });

  test('allows local providers for all tiers and denies P0 cloud', () => {
    expect(canSendToProvider('P0_LOCAL_ONLY', 'qwen-local', false)).toBe(true);
    expect(canSendToProvider('P0_LOCAL_ONLY', 'codex', true)).toBe(false);
  });

  test('requires sanitized context for P1 cloud use', () => {
    expect(canSendToProvider('P1_PRIVATE', 'minimax-m27', false)).toBe(false);
    expect(canSendToProvider('P1_PRIVATE', 'minimax-m27', true)).toBe(true);
  });

  test('allows P2/P3 cloud use and fails closed for unknown provider', () => {
    expect(canSendToProvider('P2_LIMITED_CLOUD', 'minimax-m27', false)).toBe(true);
    expect(canSendToProvider('P3_PUBLIC', 'codex', false)).toBe(true);
    const decision = explainProviderPolicy('P3_PUBLIC', 'mystery-provider', true);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('unknown provider');
  });
});
