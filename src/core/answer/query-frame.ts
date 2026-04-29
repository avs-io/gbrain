import type { QueryEntity, QueryFrame, QuerySubquestion, RequestedAspect } from './synthesis-dsl.ts';

export interface QueryFrameOptions {
  aliases?: string[];
}

const ASPECT_PATTERNS: Array<[RequestedAspect, RegExp[]]> = [
  ['summary', [/\bsummar(?:y|ize|ise)\b/, /\boverview\b/, /\bwhat(?:'s| is| was)?\b/]],
  ['definition', [/\bdefine\b/, /\bdefinition\b/, /\bmeaning\b/, /\bwhat (?:is|was|are|were)\b/]],
  ['timeline', [/\bwhen\b/, /\btimeline\b/, /\bchronolog(?:y|ical)\b/, /\bfirst\b/, /\blast\b/, /\bbefore\b/, /\bafter\b/, /\blater\b/]],
  ['incidents', [/\bincident(?:s)?\b/, /\bexamples?\b/, /\bevents?\b/, /\bcase(?:s)?\b/, /\bfriction\b/]],
  ['rationale', [/\bwhy\b/, /\brationale\b/, /\breason(?:s)?\b/, /\bbecause\b/, /\bdriver(?:s)?\b/]],
  ['change', [/\bchange(?:d|s)?\b/, /\bshift(?:ed|s)?\b/, /\bmov(?:e|ed|ing)\b/, /\bevolv(?:e|ed|ing|ution)\b/, /\btransition(?:ed)?\b/, /\bnot pursued\b/, /\bdropped\b/]],
  ['measurement', [/\bmeasurement(?:s)?\b/, /\bmetric(?:s)?\b/, /\bnumber(?:s)?\b/, /\bscore(?:s)?\b/, /\bcount(?:s)?\b/, /\b\d+(?:\.\d+)?\b/]],
  ['list_stack', [/\blist\b/, /\bstack\b/, /\bprotocol\b/, /\bregimen\b/, /\bsupplement(?:s)?\b/, /\btool(?:s|ing)?\b/, /\bitems?\b/]],
  ['relationship', [/\brelationship\b/, /\brelation\b/, /\bbetween\b/, /\bwith\b/]],
  ['current_state', [/\bcurrent(?:ly)?\b/, /\bnow\b/, /\btoday\b/, /\bpresent\b/, /\bstate now\b/]],
  ['prior_state', [/\bbefore\b/, /\bprevious(?:ly)?\b/, /\bprior\b/, /\bearlier\b/, /\binitial(?:ly)?\b/]],
  ['later_state', [/\bafter\b/, /\blater\b/, /\bsubsequent(?:ly)?\b/, /\beventual(?:ly)?\b/, /\bthen\b/]],
];

const STOP_ENTITIES = new Set([
  'what', 'when', 'why', 'how', 'who', 'where', 'which', 'did', 'does', 'do', 'was', 'were', 'is', 'are', 'the', 'and', 'or', 'but', 'with', 'between', 'before', 'after', 'during', 'not', 'pursued', 'shift', 'change', 'relationship', 'incidents', 'timeline', 'stack', 'protocol', 'supplements', 'pregnancy', 'summary', 'define', 'current', 'prior', 'later', 'state', 'idea', 'like', 'from', 'into', 'about', 'context', 'reason', 'rationale'
]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function detectRequestedAspects(text: string): RequestedAspect[] {
  const q = text.toLowerCase();
  const aspects: RequestedAspect[] = [];
  for (const [aspect, patterns] of ASPECT_PATTERNS) {
    if (patterns.some(pattern => pattern.test(q))) aspects.push(aspect);
  }
  if (aspects.length === 0) aspects.push('summary');
  return unique(aspects);
}

function splitSubquestions(query: string): string[] {
  const normalized = compact(query);
  const questionParts = normalized.split(/\?+/).map(compact).filter(Boolean);
  const parts = questionParts.length > 1 ? questionParts : normalized.split(/\s+(?:and|also|plus)\s+(?=(?:what|when|why|how|which|who|where|did|was|were|is|are)\b)/i).map(compact).filter(Boolean);
  return parts.length > 0 ? parts : [normalized];
}

function pushEntity(entities: QueryEntity[], text: string, kind: QueryEntity['kind'], source: QueryEntity['source'] = 'query') {
  const cleaned = text.replace(/[“”"'`]/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  if (!cleaned) return;
  const key = cleaned.toLowerCase();
  if (STOP_ENTITIES.has(key)) return;
  if (cleaned.length < 2) return;
  if (entities.some(entity => entity.text.toLowerCase() === key)) return;
  entities.push({ text: cleaned, kind, source });
}

export function extractQueryEntities(query: string, options: QueryFrameOptions = {}): QueryEntity[] {
  const entities: QueryEntity[] = [];

  for (const match of query.matchAll(/["'“”]([^"'“”]{2,80})["'“”]/g)) pushEntity(entities, match[1], 'quoted');
  for (const match of query.matchAll(/\b[A-Z][A-Z0-9&/-]{1,}\b/g)) pushEntity(entities, match[0], 'acronym');
  for (const match of query.matchAll(/\b[A-Z][\p{L}\p{N}'-]*(?:\s+[A-Z][\p{L}\p{N}'-]*){0,3}\b/gu)) pushEntity(entities, match[0], 'capitalized');

  const lower = query.toLowerCase();
  for (const alias of options.aliases ?? []) {
    if (alias && lower.includes(alias.toLowerCase())) pushEntity(entities, alias, 'term', 'alias');
  }

  for (const match of query.matchAll(/\b(?:about|for|on|regarding|called|named)\s+([a-z][\p{L}\p{N}'-]{2,}(?:\s+[a-z][\p{L}\p{N}'-]{2,}){0,2})/giu)) {
    const phrase = match[1].split(/\s+/).filter(word => !STOP_ENTITIES.has(word.toLowerCase())).join(' ');
    pushEntity(entities, phrase, 'term');
  }

  return entities;
}

export function buildQueryFrame(query: string, options: QueryFrameOptions = {}): QueryFrame {
  const normalizedQuery = compact(query);
  const parts = splitSubquestions(normalizedQuery);
  const subquestions: QuerySubquestion[] = parts.map((part, index) => ({
    id: `q${index + 1}`,
    text: part,
    aspects: detectRequestedAspects(part),
  }));
  const requestedAspects = unique(subquestions.flatMap(part => part.aspects));
  const q = normalizedQuery.toLowerCase();

  return {
    query,
    normalizedQuery,
    requestedAspects,
    entities: extractQueryEntities(normalizedQuery, options),
    subquestions,
    cues: {
      multiPart: subquestions.length > 1 || requestedAspects.length > 2,
      comparative: /\b(?:versus|vs\.?|between|instead of|rather than|not .* but|before .* after)\b/i.test(normalizedQuery),
      temporal: (['timeline', 'prior_state', 'later_state', 'current_state'] as RequestedAspect[]).some(aspect => requestedAspects.includes(aspect)) || /\b(?:when|before|after|later|current|now|today|first|then)\b/.test(q),
    },
  };
}
