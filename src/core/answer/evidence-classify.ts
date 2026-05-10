import type { EvidenceWindow } from './types.ts';
import type { QueryFrame, RequestedAspect } from './synthesis-dsl.ts';

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
  /** Stable source episode key used by downstream slot clustering. */
  sourceEpisode: string;
  /** Best-effort source/event date used by downstream slot clustering. */
  sourceDate?: string;
  role: EvidenceSignalRole;
  confidence: SignalConfidence;
  kind: SignalKind;
  text: string;
  speaker: EvidenceWindow['source']['speaker'];
  authority: EvidenceWindow['source']['authority'];
  sourceOrder: number;
  localOrder: number;
  score: number;
  queryOverlapTerms: string[];
  aspectOverlap: RequestedAspect[];
  safeListed: boolean;
}

export interface EvidenceRoleRule {
  role: EvidenceSignalRole;
  include: RegExp[];
  exclude?: RegExp[];
  aspects?: string[];
  confidence: SignalConfidence;
  baseScore: number;
}

const INCIDENT_KEYWORDS = /\b(?:friction|toxic|incident|incidents|time[- ]policing|work[- ]expectation|work expectations|dread|fear|kid|kids|children|not told|didn't tell|did not tell)\b/i;
const POSITIVE_RELATIONSHIP_ONLY = /\b(?:trust|thank|formative|meaningful|shaped|clarity|rigor|conviction|support|mentor|helped|valued)\b/i;

export const EVIDENCE_ROLE_RULES: EvidenceRoleRule[] = [
  { role: 'relationship_positive_signal', include: [POSITIVE_RELATIONSHIP_ONLY], exclude: [/\b(?:because|due to|reason|rationale)\b/i], aspects: ['relationship'], confidence: 'medium', baseScore: 4 },
  { role: 'relationship_friction_signal', include: [INCIDENT_KEYWORDS], aspects: ['relationship', 'incidents'], confidence: 'medium', baseScore: 5 },
  { role: 'decision_option', include: [/\b(?:option|idea|build|attempt|wedge|rail|module|stack|protocol|regimen|before|initial(?:ly)?)\b/i], aspects: ['prior_state', 'summary'], confidence: 'low', baseScore: 2 },
  { role: 'decision_rationale', include: [/\b(?:because|why|rationale|reason|due to|as the|isn't|is not|was not|wasn't|was too|too static|job isn|stronger|easier|better direction|risks?|lack of|customer|incumbents?|absorb|leverage)\b/i], aspects: ['rationale'], confidence: 'medium', baseScore: 5 },
  { role: 'deprioritization_signal', include: [/\b(?:not pursued|dropped|rejected|parked|move(?:d)? away|shift(?:ed)? away|not enough|zero network lock-in|low gravity|risks becoming|dead ev|lack of real leverage)\b/i], aspects: ['change'], confidence: 'medium', baseScore: 6 },
  { role: 'later_path_signal', include: [/\b(?:later|after|then|subsequently|eventually|became|becomes|rides on|pivot(?:ed)?|shift(?:ed)? to|move(?:d)? to|better direction|current(?:ly)?)\b/i], aspects: ['timeline', 'later_state', 'current_state'], confidence: 'medium', baseScore: 4 },
  { role: 'protocol_item', include: [/\b(?:stack|protocol|regimen|supplement|taken daily|vitamin|daily|bid|item(?:s)?|capsule(?:s)?|tablet(?:s)?|dose(?:s)?|nutrient(?:s)?)\b|\b\d+(?:\.\d+)?\s*(?:mg|g|iu)\b/i], aspects: ['list_stack'], confidence: 'medium', baseScore: 5 },
  { role: 'protocol_change', include: [/\b(?:shift(?:ing|ed)?|switch(?:ing|ed)?|instead of|changed?|replace(?:d)?|from .+ to|to \d+\s*mg)\b/i], aspects: ['change'], confidence: 'medium', baseScore: 4 },
  { role: 'measurement', include: [/\b\d+(?:\.\d+)?\s*(?:mg|g|iu|ng\/ml|w|weeks?|%|x|bid|daily)?\b/i, /\b(?:score|metric|measurement|count|hb|fgr|lab|level|marker|biomarker|window)\b/i], aspects: ['measurement'], confidence: 'medium', baseScore: 3 },
  { role: 'clinical_or_operational_reasoning', include: [/\b(?:fetal|maternal|clinical|operational|process(?:es)?|throughput|provenance|control|correctness|network|settlement|arbitration|chargeback|escrow|policy|leverage|risk|risks|window)\b/i], aspects: ['rationale'], confidence: 'medium', baseScore: 3 },
  { role: 'uncertainty', include: [/\b(?:maybe|unclear|amorphous|uncertain|not clear|wasn't clear|was not clear|might|could|wondering)\b/i], aspects: ['rationale'], confidence: 'medium', baseScore: 2 },
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

function speakerForLine(raw: string, fallback: Pick<EvidenceWindow['source'], 'speaker' | 'authority'>): Pick<EvidenceSignal, 'speaker' | 'authority'> {
  const match = raw.match(/^\s*(user|human|chief|aditya|assistant|ai|system)\s*:\s*/i);
  if (!match) return { speaker: fallback.speaker ?? 'unknown', authority: fallback.authority ?? 'unknown' };
  const rawSpeaker = match[1].toLowerCase();
  if (rawSpeaker === 'assistant' || rawSpeaker === 'ai') return { speaker: 'assistant', authority: /\b(?:accepted|confirmed|correct|agree|agreed)\b/i.test(raw) ? 'accepted_assistant_claim' : 'assistant_proposal' };
  if (rawSpeaker === 'system') return { speaker: 'system', authority: 'system' };
  return { speaker: 'user', authority: 'user_statement' };
}

function stripSpeakerPrefix(text: string): string {
  return text.replace(/^\s*(?:user|human|chief|aditya|assistant|ai|system)\s*:\s*/i, '');
}

function splitSignals(window: EvidenceWindow): Array<{ text: string; kind: SignalKind; speaker: EvidenceSignal['speaker']; authority: EvidenceSignal['authority'] }> {
  const quote = window.quote;
  const out: Array<{ text: string; kind: SignalKind; speaker: EvidenceSignal['speaker']; authority: EvidenceSignal['authority'] }> = [];
  const rawLines = quote.replace(/\r\n?/g, '\n').split('\n');
  for (const raw of rawLines) {
    const speaker = speakerForLine(raw, window.source);
    const line = compact(stripSpeakerPrefix(raw).replace(/^[-*•]\s+/, '').replace(/^Claim:\s*/i, '').replace(/^Agree:\s*/i, ''));
    if (!line) continue;
    const bullet = /^\s*[-*•]/.test(raw);
    const sentenceCandidates = line
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/)
      .map(compact)
      .filter(Boolean);
    const segments = sentenceCandidates.length > 1 ? sentenceCandidates : [line];
    const kindFor = (text: string): SignalKind => {
      const commaList = text.includes(':') && text.split(',').length >= 4;
      if (commaList) return 'list_item';
      if (/\d/.test(text)) return 'numeric';
      return bullet ? 'bullet' : sentenceCandidates.length > 1 ? 'sentence' : 'line';
    };
    for (const segment of segments) out.push({ text: segment, kind: kindFor(segment), ...speaker });
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

function matchingTerms(text: string, terms: Set<string>): string[] {
  const lower = text.toLowerCase();
  return [...terms].filter(term => lower.includes(term)).sort();
}

const ROLE_ASPECTS: Record<EvidenceSignalRole, RequestedAspect[]> = {
  relationship_positive_signal: ['relationship'],
  relationship_friction_signal: ['relationship', 'incidents'],
  decision_option: ['prior_state', 'summary'],
  decision_rationale: ['rationale'],
  deprioritization_signal: ['change', 'rationale'],
  later_path_signal: ['timeline', 'later_state', 'current_state', 'change'],
  protocol_item: ['list_stack'],
  protocol_change: ['change', 'timeline'],
  measurement: ['measurement'],
  clinical_or_operational_reasoning: ['rationale'],
  uncertainty: ['rationale'],
  distractor: [],
};

function overlappingAspects(role: EvidenceSignalRole, frame: QueryFrame): RequestedAspect[] {
  const requested = new Set(frame.requestedAspects);
  return (ROLE_ASPECTS[role] ?? []).filter(aspect => requested.has(aspect)).sort();
}

function isSafeListedSignal(role: EvidenceSignalRole, text: string, frame: QueryFrame): boolean {
  if (role === 'measurement') return /\b\d+(?:\.\d+)?\s*(?:mg|g|iu|ng\/ml|w|weeks?|%|x|bid|daily)?\b|\b(?:score|metric|measurement|count|lab|level|marker|biomarker)\b/i.test(text);
  if (role === 'protocol_item') return isStackQuestion(frame) && /\b(?:stack|protocol|regimen|supplement|vitamin|daily|bid|capsule(?:s)?|tablet(?:s)?|dose(?:s)?)\b|\b\d+(?:\.\d+)?\s*(?:mg|g|iu)\b/i.test(text);
  if (role === 'relationship_positive_signal' || role === 'relationship_friction_signal') return frame.requestedAspects.includes('relationship') || frame.requestedAspects.includes('incidents');
  if (role === 'decision_rationale' || role === 'clinical_or_operational_reasoning' || role === 'uncertainty') return frame.requestedAspects.includes('rationale') && /\b(?:because|why|reason|rationale|due to|risk|unclear|not clear)\b/i.test(text);
  if (role === 'deprioritization_signal') return (frame.requestedAspects.includes('change') || frame.requestedAspects.includes('rationale')) && /\b(?:not pursued|dropped|rejected|parked|shift(?:ed)? away|low gravity|lack of real leverage|zero network lock-in)\b/i.test(text);
  if (role === 'later_path_signal' || role === 'protocol_change') return frame.requestedAspects.some(aspect => ['timeline', 'later_state', 'current_state', 'change'].includes(aspect)) && /\b(?:later|after|then|became|becomes|pivot(?:ed)?|shift(?:ed)?|current|changed?|switch(?:ed|ing)?)\b/i.test(text);
  return false;
}

function passesOverlapGate(role: EvidenceSignalRole, queryOverlapTerms: string[], aspectOverlap: RequestedAspect[], safeListed: boolean): boolean {
  return role === 'distractor' || queryOverlapTerms.length > 0 || aspectOverlap.length > 0 || safeListed;
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
  const protocolHits = (lowered.match(/\b(?:stack|protocol|regimen|supplement|vitamin|capsule(?:s)?|tablet(?:s)?|dose(?:s)?|nutrient(?:s)?|mg|iu|bid|daily)\b/g) ?? []).length;
  return (numericHits + measurementHits) >= 4 && protocolHits === 0;
}

function classifyRole(text: string, frame: QueryFrame, terms: Set<string>): { role: EvidenceSignalRole; confidence: SignalConfidence; score: number } {
  const rel = relevance(text, terms);
  const stackQuestion = isStackQuestion(frame);
  const lower = text.toLowerCase();
  if (/\b(?:unrelated|irrelevant|distractor|not relevant)\b/i.test(text)) return { role: 'distractor', confidence: 'low', score: rel };
  if (/\b(?:not pursued|dropped|rejected|parked|move(?:d)? away|not enough|zero network lock-in|low gravity|lack of real leverage)\b/i.test(text)) return { role: 'deprioritization_signal', confidence: rel > 0 ? 'high' : 'medium', score: rel + 4 };
  if (/\b(?:why|because|due to|not clear|unclear|incumbent|zero network lock-in|better direction|harder|easier|reason|rationale)\b/i.test(text)) {
    return { role: 'decision_rationale', confidence: rel > 0 ? 'high' : 'medium', score: rel + 5 };
  }
  if (POSITIVE_RELATIONSHIP_ONLY.test(text) && !INCIDENT_KEYWORDS.test(text) && !/\b(?:not clear|unclear|because|due to|reason|rationale)\b/i.test(text)) {
    return { role: 'relationship_positive_signal', confidence: rel > 0 ? 'high' : 'medium', score: rel + 4 };
  }
  if (/\b(?:shift(?:ing|ed)?|switch(?:ing|ed)?|instead of|changed?|replace(?:d)?|from .+ to)\b/i.test(text)) return { role: 'protocol_change', confidence: rel > 0 ? 'high' : 'medium', score: rel + 4 };
  if (isMeasurementDominant(text) || /\b(?:score|metric|measurement|count|lab|level|\d+(?:\.\d+)?\s*(?:ng\/ml|%|weeks?|w))\b/i.test(text)) return { role: 'measurement', confidence: rel > 0 ? 'high' : 'medium', score: rel + 3 };
  if (stackQuestion && (/\b(?:stack|protocol|regimen|supplement|taken daily|vitamin|daily|bid|capsule(?:s)?|tablet(?:s)?|dose(?:s)?|nutrient(?:s)?)\b|\b\d+(?:\.\d+)?\s*(?:mg|g|iu)\b/i.test(text) || (text.includes(',') && !isMeasurementDominant(text) && /[A-Z][a-z]+/.test(text)))) return { role: 'protocol_item', confidence: rel > 0 ? 'high' : 'medium', score: rel + 5 };
  if (/\b(?:later|became|becomes|rides on|current|current state|active|inactive|dormant|ongoing|still|no longer|stronger base|module)\b/i.test(text)) return { role: 'later_path_signal', confidence: rel > 0 ? 'high' : 'medium', score: rel + 4 };
  if (isMeasurementDominant(text) || /\b(?:score|metric|measurement|count|hb|fgr|lab|level|\d+(?:\.\d+)?\s*(?:ng\/ml|%|weeks?|w))\b/i.test(text)) return { role: 'measurement', confidence: rel > 0 ? 'high' : 'medium', score: rel + 3 };
  let bestRole: EvidenceSignalRole | null = null;
  let best = 0;
  for (const rule of EVIDENCE_ROLE_RULES) {
    if (rule.exclude?.some(pattern => pattern.test(text))) continue;
    const score = rule.include.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
    if (score > best || (score === best && score > 0 && bestRole && rolePriority(rule.role) < rolePriority(bestRole))) {
      best = score;
      bestRole = rule.role;
    }
  }
  if (!bestRole) return { role: rel > 0 || frame.requestedAspects.includes('summary') ? 'decision_option' : 'distractor', confidence: rel > 1 ? 'medium' : 'low', score: rel };
  const rawScore = best * 2 + Math.min(rel, 3);
  const confidence: SignalConfidence = rawScore >= 4 ? 'high' : rawScore >= 2 ? 'medium' : 'low';
  if (rel === 0 && best === 1 && !/\b(?:mg|ng\/ml|toxic|trust|rejected|shift|because|risk|stack|protocol|why|reason|rationale|incumbent|lock-in|later|became|module|rides|current|friction|incident|time-policing|work expectation|dread|fear|kid|not told)\b/i.test(lower)) {
    return { role: 'distractor', confidence: 'low', score: rawScore };
  }
  return { role: bestRole, confidence, score: rawScore };
}

export function classifyEvidenceSignals(evidence: EvidenceWindow[], frame: QueryFrame): EvidenceSignal[] {
  const terms = queryTerms(frame);
  const signals: EvidenceSignal[] = [];
  for (const [sourceOrder, window] of evidence.entries()) {
    const chunks = splitSignals(window);
    chunks.forEach((chunk, localOrder) => {
      let classified = classifyRole(chunk.text, frame, terms);
      let queryOverlapTerms = matchingTerms(chunk.text, terms);
      let aspectOverlap = overlappingAspects(classified.role, frame);
      let safeListed = isSafeListedSignal(classified.role, chunk.text, frame);
      if (!passesOverlapGate(classified.role, queryOverlapTerms, aspectOverlap, safeListed)) {
        classified = { role: 'distractor', confidence: 'low', score: Math.min(classified.score, 1) };
        queryOverlapTerms = [];
        aspectOverlap = [];
        safeListed = false;
      }
      if (chunk.authority === 'assistant_proposal') {
        classified = { role: 'distractor', confidence: 'low', score: Math.min(classified.score, 1) };
        queryOverlapTerms = [];
        aspectOverlap = [];
        safeListed = false;
      }
      signals.push({
        id: `sig_${sourceOrder + 1}_${localOrder + 1}`,
        evidenceId: window.id,
        sourceEpisode: window.source.slug || window.source.id,
        sourceDate: window.source.date,
        role: classified.role,
        confidence: classified.confidence,
        kind: chunk.kind,
        text: chunk.text,
        speaker: chunk.speaker,
        authority: chunk.authority,
        sourceOrder,
        localOrder,
        score: classified.score,
        queryOverlapTerms,
        aspectOverlap,
        safeListed,
      });
    });
  }
  return signals;
}
