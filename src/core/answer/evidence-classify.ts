import type { EvidenceWindow } from './types.ts';
import type { QueryFrame } from './synthesis-dsl.ts';

export type EvidenceSignalRole =
  | 'relationship_positive_signal'
  | 'relationship_friction_signal'
  | 'decision_option'
  | 'decision_rationale'
  | 'deprioritization_signal'
  | 'later_path_signal'
  | 'protocol_item'
  | 'protocol_change'
  | 'measurement'
  | 'clinical_or_operational_reasoning'
  | 'uncertainty'
  | 'distractor';

export type SignalConfidence = 'high' | 'medium' | 'low';
export type SignalKind = 'sentence' | 'line' | 'bullet' | 'list_item' | 'numeric';

export interface EvidenceSignal {
  id: string;
  evidenceId: string;
  role: EvidenceSignalRole;
  confidence: SignalConfidence;
  kind: SignalKind;
  text: string;
  sourceOrder: number;
  localOrder: number;
  score: number;
}

const ROLE_PATTERNS: Array<[EvidenceSignalRole, RegExp[]]> = [
  ['relationship_positive_signal', [/\b(?:trust|thank|formative|meaningful|shaped|clarity|rigor|conviction|support|mentor|helped|valued)\b/i]],
  ['relationship_friction_signal', [/\b(?:friction|toxic|pressure|uncomfortable|cut a half day|weekend work|work expectations|dead ev|dissatisfaction|conflict|incident)\b/i]],
  ['decision_option', [/\b(?:option|idea|build|attempt|wedge|rail|module|stack|protocol|regimen|before|initial(?:ly)?)\b/i]],
  ['decision_rationale', [/\b(?:because|why|rationale|reason|due to|as the|isn't|is not|was not|wasn't|was too|too static|job isn|stronger|easier|better direction|risks?|lack of|customer|incumbents?|absorb|leverage)\b/i]],
  ['deprioritization_signal', [/\b(?:not pursued|dropped|rejected|parked|move(?:d)? away|shift(?:ed)? away|not enough|zero network lock-in|low gravity|risks becoming|dead ev|lack of real leverage)\b/i]],
  ['later_path_signal', [/\b(?:later|after|then|subsequently|eventually|became|becomes|rides on|pivot(?:ed)?|shift(?:ed)? to|move(?:d)? to|better direction|current(?:ly)?)\b/i]],
  ['protocol_item', [/\b(?:stack|protocol|regimen|supplement|taken daily|vitamin|mg\b|iu\b|metformin|magnesium|protein|daily|bid|creatine|probiotics|iron)\b/i]],
  ['protocol_change', [/\b(?:shift(?:ing|ed)?|switch(?:ing|ed)?|instead of|changed?|replace(?:d)?|from .+ to|to \d+\s*mg)\b/i]],
  ['measurement', [/\b\d+(?:\.\d+)?\s*(?:mg|g|iu|ng\/ml|w|weeks?|%|x|bid|daily)?\b/i, /\b(?:score|metric|measurement|count|hb|fgr|lab|level|window)\b/i]],
  ['clinical_or_operational_reasoning', [/\b(?:fetal|maternal|clinical|operational|process(?:es)?|throughput|provenance|control|correctness|network|settlement|arbitration|chargeback|escrow|policy|leverage|risk|risks|window)\b/i]],
  ['uncertainty', [/\b(?:maybe|unclear|amorphous|uncertain|not clear|wasn't clear|was not clear|might|could|wondering)\b/i]],
];

function compact(text: string): string {
  return text
    .replace(/[`*_>\uE000-\uF8FF]/g, '')
    .replace(/^\s*#{1,6}\s*/g, '')
    .replace(/\bciteturn\w+\b/gi, '')
    .replace(/\bturn\d+search\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSignals(quote: string): Array<{ text: string; kind: SignalKind }> {
  const out: Array<{ text: string; kind: SignalKind }> = [];
  const rawLines = quote.replace(/\r\n?/g, '\n').split('\n');
  for (const raw of rawLines) {
    const line = compact(raw.replace(/^[-*•]\s+/, '').replace(/^Claim:\s*/i, '').replace(/^Agree:\s*/i, ''));
    if (!line) continue;
    const bullet = /^\s*[-*•]/.test(raw);
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/).map(compact).filter(Boolean);
    const kindFor = (text: string): SignalKind => {
      const commaList = text.includes(':') && text.split(',').length >= 4;
      if (commaList) return 'list_item';
      if (/\d/.test(text)) return 'numeric';
      return bullet ? 'bullet' : 'sentence';
    };
    if (sentences.length > 1) {
      for (const sentence of sentences) out.push({ text: sentence, kind: kindFor(sentence) });
    } else {
      out.push({ text: line, kind: kindFor(line) === 'sentence' ? 'line' : kindFor(line) });
    }
  }
  return out;
}

function queryTerms(frame: QueryFrame): Set<string> {
  const terms = new Set<string>();
  for (const token of frame.normalizedQuery.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []) terms.add(token);
  for (const entity of frame.entities) for (const token of entity.text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? []) terms.add(token);
  return terms;
}

function relevance(text: string, terms: Set<string>): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const term of terms) if (lower.includes(term)) hits += 1;
  return hits;
}

const ROLE_PRIORITY: EvidenceSignalRole[] = [
  'measurement',
  'protocol_change',
  'deprioritization_signal',
  'later_path_signal',
  'protocol_item',
  'relationship_friction_signal',
  'relationship_positive_signal',
  'decision_rationale',
  'clinical_or_operational_reasoning',
  'uncertainty',
  'decision_option',
  'distractor',
];

function rolePriority(role: EvidenceSignalRole): number {
  return ROLE_PRIORITY.indexOf(role);
}

function isStackQuestion(frame: QueryFrame): boolean {
  return frame.requestedAspects.includes('list_stack') || /\b(?:stack|protocol|supplement|regimen|items?)\b/i.test(frame.normalizedQuery);
}

function isMeasurementDominant(text: string): boolean {
  const lowered = text.toLowerCase();
  const numericHits = (lowered.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length;
  const measurementHits = (lowered.match(/\b(?:score|metric|measurement|count|hb|fgr|lab|level|window|ng\/ml|mg|g|iu|%|weeks?|w|daily|bid)\b/g) ?? []).length;
  const protocolHits = (lowered.match(/\b(?:stack|protocol|regimen|supplement|vitamin|metformin|magnesium|protein|creatine|probiotics|iron|bisglycinate|ascorbate)\b/g) ?? []).length;
  return (numericHits + measurementHits) >= 4 && protocolHits === 0;
}

function classifyRole(text: string, frame: QueryFrame, terms: Set<string>): { role: EvidenceSignalRole; confidence: SignalConfidence; score: number } {
  const rel = relevance(text, terms);
  const stackQuestion = isStackQuestion(frame);
  if (/\b(?:unrelated|irrelevant|distractor|not relevant)\b/i.test(text)) return { role: 'distractor', confidence: 'low', score: rel };
  if (/\b(?:shift(?:ing|ed)?|switch(?:ing|ed)?|instead of|changed?|replace(?:d)?|from .+ to)\b/i.test(text)) return { role: 'protocol_change', confidence: rel > 0 ? 'high' : 'medium', score: rel + 3 };
  if (stackQuestion && /\b(?:stack|protocol|regimen|supplement|taken daily|iron push|vitamin|metformin|magnesium|protein|creatine|probiotics)\b/i.test(text)) return { role: 'protocol_item', confidence: rel > 0 ? 'high' : 'medium', score: rel + 4 };
  if (isMeasurementDominant(text) || /\b(?:score|metric|measurement|count|hb|fgr|lab|level|\d+(?:\.\d+)?\s*(?:ng\/ml|%|weeks?|w))\b/i.test(text)) return { role: 'measurement', confidence: rel > 0 ? 'high' : 'medium', score: rel + 3 };
  if (/\b(?:not pursued|dropped|rejected|parked|move(?:d)? away|not enough|zero network lock-in|low gravity|lack of real leverage)\b/i.test(text)) return { role: 'deprioritization_signal', confidence: rel > 0 ? 'high' : 'medium', score: rel + 3 };

  let bestRole: EvidenceSignalRole | null = null;
  let best = 0;
  for (const [role, patterns] of ROLE_PATTERNS) {
    const score = patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
    if (score > best || (score === best && score > 0 && bestRole && rolePriority(role) < rolePriority(bestRole))) {
      best = score;
      bestRole = role;
    }
  }
  if (!bestRole) return { role: rel > 0 || frame.requestedAspects.includes('summary') ? 'decision_option' : 'distractor', confidence: rel > 1 ? 'medium' : 'low', score: rel };
  const rawScore = best * 2 + Math.min(rel, 3);
  const confidence: SignalConfidence = rawScore >= 4 ? 'high' : rawScore >= 2 ? 'medium' : 'low';
  if (rel === 0 && best === 1 && !/\b(?:mg|ng\/ml|toxic|trust|rejected|shift|because|risk|stack|protocol)\b/i.test(text)) {
    return { role: 'distractor', confidence: 'low', score: rawScore };
  }
  return { role: bestRole, confidence, score: rawScore };
}

export function classifyEvidenceSignals(evidence: EvidenceWindow[], frame: QueryFrame): EvidenceSignal[] {
  const terms = queryTerms(frame);
  const signals: EvidenceSignal[] = [];
  for (const [sourceOrder, window] of evidence.entries()) {
    const chunks = splitSignals(window.quote);
    chunks.forEach((chunk, localOrder) => {
      const classified = classifyRole(chunk.text, frame, terms);
      signals.push({
        id: `sig_${sourceOrder + 1}_${localOrder + 1}`,
        evidenceId: window.id,
        role: classified.role,
        confidence: classified.confidence,
        kind: chunk.kind,
        text: chunk.text,
        sourceOrder,
        localOrder,
        score: classified.score,
      });
    });
  }
  return signals;
}
