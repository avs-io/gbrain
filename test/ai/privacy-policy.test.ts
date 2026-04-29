import { describe, expect, test } from 'bun:test';
import { assertRouteAllowed, redactRoutePrompt } from '../../src/core/ai/privacy-policy.ts';

describe('privacy gates', () => {
  test('rejects P0 cloud routing', () => {
    expect(() => assertRouteAllowed({ preferred_provider: 'codex', fallback_providers: [], require_json_schema: true, allow_external_network: true, allow_raw_private_context: false, warnings: [] }, { kind: 'world_scout', privacy: 'P0' })).toThrow('P0 cannot route to cloud providers');
  });

  test('rejects P1 raw private context', () => {
    expect(() => assertRouteAllowed({ preferred_provider: 'minimax-m27', fallback_providers: [], require_json_schema: true, allow_external_network: true, allow_raw_private_context: true, warnings: [] }, { kind: 'world_scout', privacy: 'P1', allowCloudEscalation: true })).toThrow('P1 routes must not allow raw private context');
  });

  test('redacts private prompt logging', () => {
    expect(redactRoutePrompt('secret stuff', 'P0')).toContain('[redacted-private-context]');
  });
});
