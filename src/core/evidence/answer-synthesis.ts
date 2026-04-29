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

type QueryShape = 'relationship_friction' | 'venture_lineage' | 'medical_stack' | 'generic';

interface CitationSentence {
  text: string;
  citation: AnswerCitation;
}

interface SynthesisSectionSpec {
  heading: string;
  terms: string[];
  maxSentences?: number;
  extraction?: 'sentence' | 'clause';
}

function stripSourceArtifacts(text: string): string {
  return text
    .replace(/cite[^]*/g, '')
    .replace(/citeturn\w+/gi, '')
    .replace(/turn\d+search\d+/gi, '')
    .replace(/\[Source:\s*[^\]]*\]/gi, '')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[ \t]+/g, ' ');
}

function cleanSourceLine(line: string): string {
  return stripSourceArtifacts(line)
    .trim()
    .replace(/^Claim:\s*/i, '')
    .replace(/^Agree:\s*/i, '')
    .replace(/^“([^”]+)”\s*→\s*Agree\.?$/i, '$1')
    .replace(/^[\s:–—-]+/, '')
    .trim();
}

function compactWhitespace(text: string): string {
  return stripSourceArtifacts(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(cleanSourceLine)
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

function norm(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9+/.%-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function determineQueryShape(query: string, evidence: RecallEvidence[]): QueryShape {
  const q = norm(`${query} ${evidence.map(e => `${e.title ?? ''} ${e.quote}`).join(' ')}`);
  if ((q.includes('archana') || q.includes('rukam')) && /(relationship|friction|toxic|incident|weekend|principal)/.test(q)) return 'relationship_friction';
  if (/(mwal|acc|agent commerce|praeon|rail|standalone|primary|pivot)/.test(q)) return 'venture_lineage';
  if (/(anu|pregnancy|ferrous|ferritin|bisglycinate|supplement|fgr)/.test(q)) return 'medical_stack';
  return 'generic';
}

function splitSentences(text: string): string[] {
  const compacted = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(cleanSourceLine)
    .filter(Boolean)
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z0-9*"'“])/g));
  return compacted.map(s => compactWhitespace(s)).filter(s => s.length >= 8);
}

function splitClauses(text: string): string[] {
  return splitSentences(text)
    .flatMap(sentence => sentence.split(/;\s+|,\s+(?=[A-Z][A-Za-z0-9 '+-]*(?:\d|mg|g|IU|BID|Daily|Multivitamin|Glycinate|Metformin|NAC|NMN|Vitamin|Folic|Phosphatidylcholine))/g))
    .map(clause => compactWhitespace(clause))
    .filter(clause => clause.length >= 3)
    .filter(clause => !/^Claim:\s*/i.test(clause))
    .filter(clause => !/^Agree:\s*/i.test(clause));
}

function sentenceScore(sentence: string, terms: string[]): number {
  const s = norm(sentence);
  let score = 0;
  const weakPartialTerms = new Set(['constraint', 'constraints', 'capital', 'power', 'trust', 'clear', 'customer', 'sovereign', 'leverage', 'maternal', 'stack', 'supplementation']);
  for (const term of terms) {
    const t = norm(term);
    if (!t) continue;
    if (s.includes(t)) score += Math.max(2, Math.min(8, t.split(' ').length + 1));
    else if (t.split(' ').some(part => part.length >= 6 && !weakPartialTerms.has(part) && s.includes(part))) score += 1;
  }
  if (/\b(?:question|\?$|claim|agree|therefore|thus|however|meanwhile)\b/i.test(sentence)) score -= 3;
  return score;
}

function sentenceKey(sentence: string): string {
  return norm(sentence).slice(0, 180);
}

function selectSentences(
  evidence: RecallEvidence[],
  citations: AnswerCitation[],
  terms: string[],
  maxSentences: number,
  maxQuoteChars: number,
  alreadyUsed: Set<string>,
  extraction: 'sentence' | 'clause' = 'sentence',
): CitationSentence[] {
  const priorityTerms = ['later', 'became', 'module', 'rides on', 'on top', 'base rail', 'current target'];
  const candidates: Array<CitationSentence & { score: number; evIndex: number; sentenceIndex: number; priority: number }> = [];
  for (let evIndex = 0; evIndex < evidence.length; evIndex++) {
    const ev = evidence[evIndex];
    const citation = citations[evIndex];
    const sentences = extraction === 'clause' ? splitClauses(ev.quote) : splitSentences(ev.quote);
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
      const text = sentences[sentenceIndex];
      const score = sentenceScore(text, terms);
      if (score <= 0) continue;
      const priority = priorityTerms.reduce((sum, term) => sum + (norm(text).includes(norm(term)) ? 1 : 0), 0);
      candidates.push({ text, citation, score, evIndex, sentenceIndex, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority || b.score - a.score || a.sentenceIndex - b.sentenceIndex || a.evIndex - b.evIndex);
  const selected: CitationSentence[] = [];
  for (const candidate of candidates) {
    if (selected.length >= maxSentences) break;
    const key = sentenceKey(candidate.text);
    if (alreadyUsed.has(key)) continue;
    alreadyUsed.add(key);
    selected.push({ ...candidate, text: truncateAtBoundary(candidate.text, maxQuoteChars) });
  }
  return selected;
}

function sectionSpecs(shape: QueryShape): SynthesisSectionSpec[] {
  if (shape === 'relationship_friction') {
    return [
      {
        heading: 'Relationship frame',
        terms: ['meaningful and formative', 'shaped by my time', 'Archana', 'trust you placed', 'clarity', 'rigor', 'conviction'],
        maxSentences: 2,
      },
      {
        heading: 'High-friction Rukam incidents',
        terms: ['10:05 instead of 10', 'time policing', 'cut a half day', 'drive to work', 'had a kid', 'toxic', 'principal', 'dead EV', 'weekend work expectations', 'workload tracking', 'extra weekend work'],
        maxSentences: 6,
      },
    ];
  }
  if (shape === 'venture_lineage') {
    return [
      {
        heading: 'Lineage before MWAL',
        terms: ['Agent Commerce Clearinghouse', 'ACC', 'portable receipts', 'settlement', 'arbitration'],
        maxSentences: 2,
      },
      {
        heading: 'Why ACC/MWAL were not enough as the base rail',
        terms: ['Why not ACC as the top rail', 'incumbents', 'module that rides', 'rides on', 'current state', 'customer was not clear', 'customer wasn\'t clear', 'amorphous', 'ecosystem gravity', 'zero network lock-in', 'stronger base', 'elegant spec'],
        maxSentences: 4,
      },
      {
        heading: 'Praeon-style rail lesson',
        terms: ['Praeon', 'sovereign AI rail', 'policy theatre', 'lack of real leverage', 'not where intelligence meets physics', 'capital', 'power', 'throughput'],
        maxSentences: 3,
      },
    ];
  }
  if (shape === 'medical_stack') {
    return [
      {
        heading: 'Supplement stack captured in source',
        terms: ['Maternal Supplementation Stack', 'Vitamin C', 'Folic acid', 'Methylfolate', 'NMN', 'NAC', 'Phosphatidylcholine', 'Vitamin D3', 'Creatine', 'Magnesium', 'Metformin'],
        maxSentences: 12,
        extraction: 'clause',
      },
      {
        heading: 'Initial iron plan',
        terms: ['Iron push', 'Ferrous bisglycinate', 'lactoferrin', 're-test ferritin', '45 ng/mL'],
        maxSentences: 2,
      },
      {
        heading: 'Ferrous ascorbate / ferritin context',
        terms: ['100mg ferrous ascorbate', '100 mg ferrous ascorbate', '31–32 w', 'ferritin 19.9', 'FGR', 'fetal iron', 'slow, GI-hard path'],
        maxSentences: 3,
      },
    ];
  }
  return [];
}


function shapeTerms(shape: QueryShape): string[] {
  return sectionSpecs(shape).flatMap(spec => spec.terms);
}

function termAnchors(terms: string[]): string[] {
  const anchors = new Set<string>();
  for (const term of terms) {
    const normalized = norm(term);
    if (!normalized) continue;
    if (normalized.length >= 4) anchors.add(normalized);
    for (const part of normalized.split(' ')) {
      if (part.length >= 5) anchors.add(part);
    }
  }
  return [...anchors];
}

function evidenceScore(ev: RecallEvidence, terms: string[]): number {
  return splitSentences(ev.quote).reduce((score, sentence) => score + sentenceScore(sentence, terms), 0);
}

function evidenceAnchors(ev: RecallEvidence, anchors: string[]): Set<string> {
  const q = norm(`${ev.title ?? ''} ${ev.quote}`);
  const found = new Set<string>();
  for (const anchor of anchors) {
    if (anchor && q.includes(anchor)) found.add(anchor);
  }
  return found;
}

function pruneEvidenceForSynthesis(query: string, evidence: RecallEvidence[], maxEvidence: number): RecallEvidence[] {
  const shape = determineQueryShape(query, evidence);
  if (shape === 'generic') return evidence.slice(0, maxEvidence);

  const terms = shapeTerms(shape);
  const anchors = termAnchors(terms);
  const ranked = evidence
    .map((ev, index) => ({ ev, index, score: evidenceScore(ev, terms), anchors: evidenceAnchors(ev, anchors) }))
    .filter(item => item.score > 0 || item.anchors.size > 0)
    .sort((a, b) => b.score - a.score || b.anchors.size - a.anchors.size || a.index - b.index);

  const kept: typeof ranked = [];
  const covered = new Set<string>();
  for (const item of ranked) {
    if (kept.length >= maxEvidence) break;
    const unique = [...item.anchors].filter(anchor => !covered.has(anchor));
    if (kept.length > 0 && unique.length === 0) continue;
    kept.push(item);
    for (const anchor of item.anchors) covered.add(anchor);
  }

  if (!kept.length) return evidence.slice(0, maxEvidence);

  const selectedEvidence = new Set<number>();
  const usedSentences = new Set<string>();
  const keptInOriginalOrder = kept.sort((a, b) => a.index - b.index);
  for (const spec of sectionSpecs(shape)) {
    const candidates: Array<{ keptIndex: number; score: number; sentenceIndex: number; text: string; priority: number }> = [];
    for (let keptIndex = 0; keptIndex < keptInOriginalOrder.length; keptIndex++) {
      const sentences = splitSentences(keptInOriginalOrder[keptIndex].ev.quote);
      for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
        const score = sentenceScore(sentences[sentenceIndex], spec.terms);
        if (score > 0) {
          const priority = ['later', 'became', 'module', 'rides on', 'on top', 'base rail', 'current target']
            .reduce((sum, term) => sum + (norm(sentences[sentenceIndex]).includes(norm(term)) ? 1 : 0), 0);
          candidates.push({ keptIndex, score, sentenceIndex, text: sentences[sentenceIndex], priority });
        }
      }
    }
    candidates.sort((a, b) => b.priority - a.priority || b.score - a.score || a.sentenceIndex - b.sentenceIndex || a.keptIndex - b.keptIndex);
    let selectedForSection = 0;
    for (const candidate of candidates) {
      if (selectedForSection >= (spec.maxSentences ?? 2)) break;
      const key = sentenceKey(candidate.text);
      if (usedSentences.has(key)) continue;
      usedSentences.add(key);
      selectedEvidence.add(candidate.keptIndex);
      selectedForSection++;
    }
  }

  const contributing = keptInOriginalOrder.filter((_item, keptIndex) => selectedEvidence.has(keptIndex));
  return (contributing.length ? contributing : keptInOriginalOrder).map(item => item.ev);
}

function fallbackSentence(ev: RecallEvidence, citation: AnswerCitation, maxQuoteChars: number): CitationSentence {
  return { text: truncateAtBoundary(compactWhitespace(ev.quote), maxQuoteChars), citation };
}

function citationKey(citation: AnswerCitation): string {
  return `${citation.label}\u0000${citation.span_id}`;
}

function citationGroup(citations: AnswerCitation[]): string {
  const ordered: AnswerCitation[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const key = citationKey(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(citation);
  }
  return ordered.map(citation => `[${citation.label}]`).join('');
}

function citedLine(sentence: CitationSentence): string {
  return `${sentence.text} ${citationGroup([sentence.citation])}`;
}

function cleanSentenceFragment(text: string): string {
  const fragment = text.replace(/\s+$/g, '').replace(/[;:,]+$/g, '').trim();
  return fragment
    .replace(/([.!?])[.!?]+$/g, '$1')
    .replace(/([.!?]\s+)([a-z])/g, (_match, boundary: string, first: string) => `${boundary}${first.toUpperCase()}`);
}

function cleanClauseFragment(text: string): string {
  return text.replace(/\s+$/g, '').replace(/[.!?;:,]+$/g, '').trim();
}

function hasSentenceTerminal(fragment: string): boolean {
  return /[.!?][\]")'”’]*$/.test(fragment.trim());
}

function looksLikeSentence(fragment: string): boolean {
  return hasSentenceTerminal(fragment) || fragment.length >= 110;
}

function capitalizeSentenceStart(fragment: string): string {
  return fragment.replace(/^(\s*[\[("'“‘]*)([a-z])/, (_match, prefix: string, first: string) => `${prefix}${first.toUpperCase()}`);
}

function renderSentenceFragment(fragment: string): string {
  const cleaned = cleanSentenceFragment(fragment);
  if (!cleaned) return '';
  const capped = capitalizeSentenceStart(cleaned);
  return hasSentenceTerminal(capped) ? capped : `${capped}.`;
}

function continuationItem(item: string): string {
  return item.replace(/^(But|Every|In|She|Switching|The|This|You)\b/, match => match.toLowerCase());
}

function naturalJoin(items: string[], separator: string): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]}, and ${continuationItem(items[1])}`;
  const tail = items.at(-1) ?? '';
  return `${items.slice(0, -1).map((item, index) => index === 0 ? item : continuationItem(item)).join(separator)}${separator}and ${continuationItem(tail)}`;
}

function joinClusterText(sentences: CitationSentence[]): string {
  const rawFragments = sentences.map(sentence => sentence.text.trim()).filter(Boolean);
  if (rawFragments.length <= 1) return cleanSentenceFragment(rawFragments[0] ?? '');

  const ordered = rawFragments.slice().sort((a, b) => {
    const ap = ['later', 'became', 'module', 'rides on', 'on top', 'base rail', 'current target'].reduce((sum, term) => sum + (norm(a).includes(norm(term)) ? 1 : 0), 0);
    const bp = ['later', 'became', 'module', 'rides on', 'on top', 'base rail', 'current target'].reduce((sum, term) => sum + (norm(b).includes(norm(term)) ? 1 : 0), 0);
    return bp - ap;
  });

  if (ordered.some(looksLikeSentence)) return ordered.map(renderSentenceFragment).filter(Boolean).join(' ');
  return naturalJoin(ordered.map(cleanClauseFragment).filter(Boolean), ', ');
}

function citedCluster(sentences: CitationSentence[]): string {
  if (!sentences.length) return '';
  return `${joinClusterText(sentences)} ${citationGroup(sentences.map(sentence => sentence.citation))}`;
}

function clusterByCitation(sentences: CitationSentence[]): CitationSentence[][] {
  const clusters: CitationSentence[][] = [];
  for (const sentence of sentences) {
    const previous = clusters.at(-1);
    if (previous && citationKey(previous[0].citation) === citationKey(sentence.citation)) previous.push(sentence);
    else clusters.push([sentence]);
  }
  return clusters;
}

function renderStructuredSection(heading: string, picked: CitationSentence[]): string[] {
  const clusters = clusterByCitation(picked).map(citedCluster).filter(Boolean);
  if (clusters.length <= 2) return [`- ${heading}: ${clusters.join(' ')}`];
  return [`- ${heading}:`, ...clusters.map(cluster => `  - ${cluster}`)];
}

function buildStructuredAnswer(query: string, evidence: RecallEvidence[], citations: AnswerCitation[], maxQuoteChars: number): string {
  const shape = determineQueryShape(query, evidence);
  const used = new Set<string>();
  const lines: string[] = ['Deterministic evidence-backed draft (memory answer):'];

  if (shape !== 'generic') {
    for (const spec of sectionSpecs(shape)) {
      const picked = selectSentences(evidence, citations, spec.terms, spec.maxSentences ?? 2, maxQuoteChars, used, spec.extraction ?? 'sentence');
      if (!picked.length) continue;
      lines.push(...renderStructuredSection(spec.heading, picked));
    }
  }

  if (lines.length === 1) {
    lines.push('What the retrieved evidence says:');
    for (let i = 0; i < evidence.length; i++) lines.push(`- ${citedLine(fallbackSentence(evidence[i], citations[i], maxQuoteChars))}`);
  } else {
    const cited = new Set(lines.join('\n').match(/\[S\d+\]/g) ?? []);
    for (let i = 0; i < evidence.length; i++) {
      if (cited.has(`[${citations[i].label}]`)) continue;
      lines.push(`- Additional exact source window: ${citedLine(fallbackSentence(evidence[i], citations[i], maxQuoteChars))}`);
    }
  }

  lines.push('', 'Evidence spans:');
  for (const citation of citations) lines.push(`- [${citation.label}] ${citation.span_id}`);
  lines.push('', 'Boundary: deterministic synthesis only uses exact retrieved gbs1 source windows; section labels are deterministic query-shape labels, content claims are cited, and no uncited factual claim is added.');
  return lines.join('\n');
}

export function synthesizeAnswerFromRecall(recall: RecallResult, opts: AnswerSynthesisOptions = {}): AnswerSynthesisResult {
  const maxEvidence = Math.max(1, opts.maxEvidence ?? 4);
  const maxQuoteChars = Math.max(80, opts.maxQuoteChars ?? 420);
  const warnings = [...recall.warnings];

  const exactEvidence = recall.evidence.filter(ev => ev.span_id.startsWith('gbs1:') && ev.quote.trim().length > 0);
  if (exactEvidence.length !== recall.evidence.length) warnings.push('non-gbs1 or empty evidence was excluded from answer synthesis');

  if (recall.status === 'abstain' || exactEvidence.length === 0) {
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

  const evidence = pruneEvidenceForSynthesis(recall.query, exactEvidence, maxEvidence);
  if (evidence.length < Math.min(exactEvidence.length, maxEvidence)) warnings.push('low-relevance or duplicate source windows were excluded from answer synthesis');
  const citations = evidence.map(citationFor);

  return {
    schema: ANSWER_SYNTHESIS_SCHEMA,
    query: recall.query,
    status: 'hit',
    answer: buildStructuredAnswer(recall.query, evidence, citations, maxQuoteChars),
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
