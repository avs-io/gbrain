import { describe, expect, test } from 'bun:test';

import {
  GBRAIN_NAMESPACES,
  classifyNamespacePolicy,
  conservativeNamespacePolicyDefaults,
  validateNamespacePolicy,
} from '../src/core/memory/namespace-policy.ts';

describe('namespace access policy', () => {
  test('defines the first-class namespaces required by PR4', () => {
    expect([...GBRAIN_NAMESPACES]).toEqual(['personal', 'ventures', 'world', 'network', 'scouts', 'actions', 'evals']);
  });

  test('defaults conservatively for omitted policy fields', () => {
    expect(conservativeNamespacePolicyDefaults()).toEqual({ namespace: 'personal', privacy: 'private', sensitivity: 'high' });
    const classified = classifyNamespacePolicy({});
    expect(classified.context_visibility).toBe('metadata_only');
    expect(classified.agent_read).toBe('review_required');
    expect(classified.trusted_write).toBe('review_required');
    expect(classified.external_action).toBe('denied');
  });

  test('allows low-sensitivity world/scout/eval style context', () => {
    expect(validateNamespacePolicy({ namespace: 'world', privacy: 'public', sensitivity: 'low' })).toEqual([]);
    expect(classifyNamespacePolicy({ namespace: 'scouts', privacy: 'internal', sensitivity: 'medium' })).toMatchObject({
      context_visibility: 'full',
      agent_read: 'allowed',
    });
  });

  test('rejects unsafe namespace/privacy/sensitivity combinations', () => {
    expect(validateNamespacePolicy({ namespace: 'personal', privacy: 'public', sensitivity: 'low' })).toContain('personal namespace cannot be public by default');
    expect(validateNamespacePolicy({ namespace: 'world', privacy: 'public', sensitivity: 'high' })).toContain('public privacy cannot be paired with high or restricted sensitivity');
    expect(validateNamespacePolicy({ namespace: 'network', privacy: 'confidential', sensitivity: 'medium' })).toContain('confidential privacy requires high or restricted sensitivity');
    expect(validateNamespacePolicy({ namespace: 'scouts', privacy: 'confidential', sensitivity: 'high' })).toContain('scouts namespace should not be confidential; use personal/network/ventures for sensitive internal facts');
  });

  test('actions namespace requires explicit approval for action use', () => {
    const classified = classifyNamespacePolicy({ namespace: 'actions', privacy: 'internal', sensitivity: 'medium' });
    expect(classified.external_action).toBe('explicit_approval_required');
    expect(validateNamespacePolicy({ namespace: 'actions', privacy: 'public', sensitivity: 'low' })).toContain('actions namespace cannot be public');
  });
});
