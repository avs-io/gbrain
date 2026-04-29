import type { AnswerPromotionCase, AnswerPromotionReport } from './promotion-eval.ts';
import type { RecallDiagnosticsEnvelope } from '../evidence/recall-diagnostics.ts';

export type RegressionPackCaseInput = AnswerPromotionCase & { recall_diagnostics?: RecallDiagnosticsEnvelope; warnings?: string[] };

export type RegressionPackCase = {
  id: string;
  query: string;
  status: string;
  recall_diagnostics?: Pick<RecallDiagnosticsEnvelope, 'recommendation' | 'evidence_count' | 'gbs1_count' | 'non_gbs1_count' | 'duplicate_span_count' | 'warnings'>;
  warnings: string[];
  promotion_pass: boolean;
  envelope?: unknown;
};

export type RegressionPackArtifact = {
  schema: 'gbrain.answer_v2_regression_pack.v1';
  generated_at: string;
  commit: string | null;
  report: Pick<AnswerPromotionReport, 'schema' | 'ok' | 'pass_count' | 'fail_count' | 'gate_version' | 'recommendation'>;
  cases: RegressionPackCase[];
};

export function buildRegressionPackArtifact(report: AnswerPromotionReport, cases: RegressionPackCaseInput[], options: { generatedAt: string; commit?: string | null; includeEnvelopes?: boolean }): RegressionPackArtifact {
  const failureSet = new Set(report.failures.map(f => f.case_id));
  return {
    schema: 'gbrain.answer_v2_regression_pack.v1',
    generated_at: options.generatedAt,
    commit: options.commit ?? null,
    report: {
      schema: report.schema,
      ok: report.ok,
      pass_count: report.pass_count,
      fail_count: report.fail_count,
      gate_version: report.gate_version,
      recommendation: report.recommendation,
    },
    cases: cases.map(item => ({
      id: item.id,
      query: item.query ?? '',
      status: item.envelope.status,
      recall_diagnostics: item.recall_diagnostics ? {
        recommendation: item.recall_diagnostics.recommendation,
        evidence_count: item.recall_diagnostics.evidence_count,
        gbs1_count: item.recall_diagnostics.gbs1_count,
        non_gbs1_count: item.recall_diagnostics.non_gbs1_count,
        duplicate_span_count: item.recall_diagnostics.duplicate_span_count,
        warnings: item.recall_diagnostics.warnings,
      } : undefined,
      warnings: item.warnings ?? item.envelope.warnings ?? [],
      promotion_pass: !failureSet.has(item.id),
      ...(options.includeEnvelopes ? { envelope: item.envelope } : {}),
    })),
  };
}
