import { describe, expect, test } from 'bun:test';
import { evaluatePreferenceDecision, validatePreferenceDecisionEvaluation } from '../src/core/context/preference-decision-evaluator.ts';

describe('preference / decision evaluator', () => {
  test('scores sovereignty, leverage, mission, evidence, and next action class deterministically', () => {
    const evaluation = evaluatePreferenceDecision({
      text: 'Decision today: ship the local sovereign memory kernel worker because it compounds leverage and keeps private data under control.',
      evidence_span_ids: ['gbs1:default:sources/test#compiled_truth:L1-L4'],
      generatedAt: '2026-05-08T10:00:00Z',
    });

    expect(validatePreferenceDecisionEvaluation(evaluation)).toEqual([]);
    expect(evaluation.signal_class).toBe('mission_leverage');
    expect(evaluation.next_action_class).toBe('interrupt');
    expect(evaluation.scores.would_care).toBeGreaterThan(0.55);
    expect(evaluation.scores.evidence_confidence).toBe(1);
    expect(evaluation.guardrails.model_api_calls).toBe(false);
    expect(evaluation.guardrails.external_action).toBe(false);
    expect(evaluation.guardrails.trusted_memory_write).toBe(false);
  });

  test('downgrades high-sounding unevidenced signals to human judgment rather than action', () => {
    const evaluation = evaluatePreferenceDecision({
      text: 'Urgent frontier mission opportunity with leverage but no source attached; decide now.',
      generatedAt: '2026-05-08T10:00:00Z',
    });

    expect(validatePreferenceDecisionEvaluation(evaluation)).toEqual([]);
    expect(evaluation.scores.evidence_confidence).toBeLessThan(0.5);
    expect(evaluation.next_action_class).toBe('ask_for_human_judgment');
    expect(evaluation.reasons).toContain('low evidence confidence prevents high-confidence action');
  });

  test('archives explicit operational noise', () => {
    const evaluation = evaluatePreferenceDecision({
      text: 'FYI only: routine low value noise, no decision needed.',
      evidence_span_ids: ['gbs1:default:sources/test#compiled_truth:L8-L9'],
      generatedAt: '2026-05-08T10:00:00Z',
    });

    expect(evaluation.signal_class).toBe('operational_noise');
    expect(evaluation.next_action_class).toBe('archive');
  });
});
