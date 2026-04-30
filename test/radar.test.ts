import { describe, expect, test } from 'bun:test';
import type { ClaimLedgerRecord } from '../src/core/claims/claim-ledger.ts';
import { evidenceRefFromSpan, hashQuote } from '../src/core/claims/claim-ledger.ts';
import { buildRadarReport, radarCandidateFromClaimLedgerRecord, radarCandidateFromScoutObservation, scoreRadarCandidates } from '../src/core/memory/radar.ts';
import type { ScoutObservation } from '../src/core/memory/scoutnet.ts';

const NOW = new Date('2026-04-29T07:30:00.000Z');

function scout(overrides: Partial<ScoutObservation> = {}): ScoutObservation {
  return {
    schema: 'gbrain.scout.observation.v1',
    id: 'scout_obs_test_001',
    recipe_id: 'sovereign-ai-india',
    observed_at: '2026-04-29T07:05:00.000Z',
    namespace: 'scouts',
    privacy: 'internal',
    sensitivity: 'medium',
    status: 'proposed',
    source: {
      source_id: 'local-authority-map',
      name: 'Local sovereign-ai authority reports',
      kind: 'local_report',
      title: 'Authority map',
      retrieved_at: '2026-04-29T07:05:00.000Z',
      citation: 'Local report citation.',
      citation_url: 'file://ops/reports/sovereign-ai-authority/README.md',
    },
    coverage: {
      query: 'IndiaAI unresolved authority map questions',
      checked_at: '2026-04-29T07:05:00.000Z',
      freshness_window_days: 7,
      method: 'local_sample',
    },
    signal: {
      summary: 'Resolve high-priority authority map gaps before treating the map as current.',
      quote: 'Known open questions: IndiaAI CEO successor; DG NIC discrepancy.',
      novelty: 0.7,
      relevance: 0.95,
      confidence: 0.84,
    },
    recommended_next_action: {
      type: 'research',
      rationale: 'Review source-backed facts before trusted update.',
      owner: 'scoutnet',
    },
    guardrails: {
      observation_is_proposal: true,
      trusted_world_model_updated: false,
      trusted_pages_edited: false,
      external_messages_sent: false,
      live_web_crawl_performed: false,
    },
    ...overrides,
  };
}

describe('radar surfacing candidates', () => {
  test('scores ScoutNet observations into review-only candidates with evidence and guardrails', () => {
    const candidate = radarCandidateFromScoutObservation(scout(), { now: NOW });

    expect(candidate.schema).toBe('gbrain.radar.candidate.v1');
    expect(candidate.review_queue_only).toBe(true);
    expect(candidate.guardrails.user_facing_interrupt_sent).toBe(false);
    expect(candidate.guardrails.trusted_pages_edited).toBe(false);
    expect(candidate.guardrails.external_messages_sent).toBe(false);
    expect(candidate.source.kind).toBe('scout_observation');
    expect(candidate.source.evidence_ids).toContain('scout_obs_test_001');
    expect(candidate.source.evidence_ids).toContain('local-authority-map');
    expect(candidate.scores.final).toBeGreaterThan(0.5);
    expect(['immediate-review', 'daily-brief']).toContain(candidate.band);
  });

  test('private/high candidates are capped below immediate-review unless explicitly allowed', () => {
    const sensitive = radarCandidateFromScoutObservation(scout({ privacy: 'private', sensitivity: 'high', namespace: 'personal' }), { now: NOW });
    const allowed = radarCandidateFromScoutObservation(scout({ privacy: 'private', sensitivity: 'high', namespace: 'personal' }), { now: NOW, allowSensitiveImmediate: true });

    expect(sensitive.policy.immediate_review_allowed).toBe(false);
    expect(sensitive.band).not.toBe('immediate-review');
    expect(sensitive.policy.warnings.join(' ')).toContain('capped below immediate-review');
    expect(allowed.policy.immediate_review_allowed).toBe(true);
  });

  test('low-signal monitor observations archive or digest rather than interrupt', () => {
    const candidate = radarCandidateFromScoutObservation(scout({
      signal: { summary: 'Routine monitoring note with little new information.', novelty: 0.05, relevance: 0.25, confidence: 0.45 },
      recommended_next_action: { type: 'monitor', rationale: 'Keep watching.', owner: 'scoutnet' },
    }), { now: NOW });

    expect(candidate.scores.annoyance_risk).toBeGreaterThan(0.45);
    expect(['weekly-digest', 'archive']).toContain(candidate.band);
  });

  test('claim-ledger records produce evidence-addressed radar candidates', () => {
    const quote = 'Durable trusted GBrain write-back should remain review gated.';
    const record: ClaimLedgerRecord = {
      id: 'claim_20260429T070000Z_abcdef123456',
      schema_version: 1,
      created_at: '2026-04-29T07:00:00.000Z',
      updated_at: '2026-04-29T07:00:00.000Z',
      claim: 'Trusted writeback remains review-gated.',
      type: 'decision',
      status: 'proposed',
      namespace: 'ventures',
      privacy: 'internal',
      sensitivity: 'medium',
      confidence: 0.8,
      observed_at: '2026-04-29T07:00:00.000Z',
      evidence: [evidenceRefFromSpan('gbs1:src:slug#main:L1-L2', quote)],
      review_required: true,
      guardrails: { trusted_pages_edited: false, external_messages_sent: false, global_config_changed: false, record_is_review_only: true },
    };

    const candidate = radarCandidateFromClaimLedgerRecord(record, { now: NOW });
    expect(candidate.source.kind).toBe('claim_ledger_record');
    expect(candidate.source.evidence_ids).toEqual(['gbs1:src:slug#main:L1-L2']);
    expect(candidate.guardrails.user_facing_interrupt_sent).toBe(false);
  });

  test('builds sorted report band counts with notifications disabled', () => {
    const candidates = scoreRadarCandidates({ scoutObservations: [scout({ id: 'scout_obs_test_002', signal: { summary: 'Low', novelty: 0.1, relevance: 0.2, confidence: 0.4 } }), scout()], now: NOW });
    const report = buildRadarReport({ candidates, source: 'unit-test', now: NOW });

    expect(report.schema).toBe('gbrain.radar.report.v1');
    expect(report.candidate_count).toBe(2);
    expect(report.guardrails.automatic_notifications_enabled).toBe(false);
    expect(report.candidates[0].scores.final).toBeGreaterThanOrEqual(report.candidates[1].scores.final);
    expect(Object.values(report.band_counts).reduce((a, b) => a + b, 0)).toBe(2);
  });
});
