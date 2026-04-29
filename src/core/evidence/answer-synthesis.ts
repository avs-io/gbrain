import type { RecallEvidence, RecallResult } from './recall.ts';

export const ANSWER_SYNTHESIS_SCHEMA = 'gbrain.answer_synthesis.v1';

export interface AnswerCitation {
  label: string;
  span_id: string;
  source_id: string;
  slug: string;
  title?: string;
  section: string;
  start_line: number;
  end_line: number;
  quote_hash: string;
}

export interface AnswerSynthesisOptions {
  maxEvidence?: number;
  maxQuoteChars?: number;
}

export interface AnswerSynthesisResult {
  schema: typeof ANSWER_SYNTHESIS_SCHEMA;
  query: string;
  status: 'hit' | 'abstain';
  answer: string;
  citations: AnswerCitation[];
  evidence: RecallEvidence[];
  warnings: string[];
  bounds: {
    deterministic: true;
    abstain_if_no_exact_span: true;
    max_evidence: number;
    max_quote_chars: number;
  };
  integration: RecallResult['integration'];
}

function compactWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hard = text.slice(0, Math.max(0, maxChars - 1));
  const boundary = Math.max(hard.lastIndexOf('. '), hard.lastIndexOf('; '), hard.lastIndexOf(', '), hard.lastIndexOf(' '));
  const cut = boundary > Math.floor(maxChars * 0.55) ? hard.slice(0, boundary) : hard;
  return `${cut.trim()}…`;
}

function citationFor(ev: RecallEvidence, index: number): AnswerCitation {
  return {
    label: `S${index + 1}`,
    span_id: ev.span_id,
    source_id: ev.source_id,
    slug: ev.slug,
    title: ev.title,
    section: ev.section,
    start_line: ev.start_line,
    end_line: ev.end_line,
    quote_hash: ev.quote_hash,
  };
}

export function synthesizeAnswerFromRecall(recall: RecallResult, opts: AnswerSynthesisOptions = {}): AnswerSynthesisResult {
  const maxEvidence = Math.max(1, opts.maxEvidence ?? 4);
  const maxQuoteChars = Math.max(80, opts.maxQuoteChars ?? 420);
  const warnings = [...recall.warnings];

  if (recall.status === 'abstain' || recall.evidence.length === 0) {
    if (!warnings.some(w => /abstain/i.test(w))) warnings.push('no exact source evidence supplied to answer synthesis; abstaining');
    return {
      schema: ANSWER_SYNTHESIS_SCHEMA,
      query: recall.query,
      status: 'abstain',
      answer: '',
      citations: [],
      evidence: [],
      warnings,
      bounds: {
        deterministic: true,
        abstain_if_no_exact_span: true,
        max_evidence: maxEvidence,
        max_quote_chars: maxQuoteChars,
      },
      integration: recall.integration,
    };
  }

  const evidence = recall.evidence.slice(0, maxEvidence);
  const citations = evidence.map(citationFor);
  const bullets = evidence.map((ev, index) => {
    const quote = truncateAtBoundary(compactWhitespace(ev.quote), maxQuoteChars);
    return `- [${citations[index].label}] ${quote} (${ev.span_id})`;
  });

  return {
    schema: ANSWER_SYNTHESIS_SCHEMA,
    query: recall.query,
    status: 'hit',
    answer: [
      'Deterministic evidence-backed draft:',
      ...bullets,
      '',
      'Boundary: this draft only restates exact retrieved source windows; it does not infer beyond the cited spans.',
    ].join('\n'),
    citations,
    evidence,
    warnings,
    bounds: {
      deterministic: true,
      abstain_if_no_exact_span: true,
      max_evidence: maxEvidence,
      max_quote_chars: maxQuoteChars,
    },
    integration: recall.integration,
  };
}
