import { basename } from 'node:path';

import { evidenceRefFromSpan, hashQuote, type ClaimEvidenceRef } from '../claims/claim-ledger.ts';

export const PERSONAL_CONTEXT_PACK_SCHEMA = 'gbrain.personal_context_pack.v1';

export type PersonalContextTask = 'meeting_brief' | 'opportunity_eval' | 'strategy_review' | 'memory_answer';
export type PersonalContextProfile = 'aditya';
export type PersonalContextFactKind = 'fact' | 'preference' | 'inference';

export type PersonalContextEvidenceRef = {
  span_id: string;
  quote: string;
  quote_hash: string;
  source_id?: string;
  slug?: string;
  section?: string;
  start_line?: number;
  end_line?: number;
};

export type PersonalContextPackItem = {
  text: string;
  kind: PersonalContextFactKind;
  evidence_span_ids: string[];
  evidence?: PersonalContextEvidenceRef[];
};

export type PersonalContextPack = {
  schema: typeof PERSONAL_CONTEXT_PACK_SCHEMA;
  profile: PersonalContextProfile;
  task: PersonalContextTask;
  subject: string;
  generated_at: string;
  sections: {
    identity_constraints: PersonalContextPackItem[];
    current_bets: PersonalContextPackItem[];
    family_constraints: PersonalContextPackItem[];
    decision_filters: PersonalContextPackItem[];
    communication_preferences: PersonalContextPackItem[];
    anti_patterns: PersonalContextPackItem[];
    active_context: PersonalContextPackItem[];
  };
  evidence_index: Array<PersonalContextEvidenceRef & { item_ids: string[] }>;
  metadata: {
    privacy: 'local_only';
    freshness: {
      generated_at: string;
      max_age_hours: number;
      source_ttl_hours: number;
      stale_after: string;
    };
    guardrails: {
      deterministic: true;
      local_only: true;
      trusted_pages_edited: false;
      external_messages_sent: false;
      global_config_changed: false;
      model_api_calls: false;
      no_private_fact_hardcoding: true;
    };
  };
  warnings: string[];
};

export type PersonalContextInput = {
  profile?: PersonalContextProfile;
  task: PersonalContextTask;
  subject?: string;
  generatedAt?: string | Date;
  facts?: string[];
  preferences?: string[];
  inferences?: string[];
  snippets?: Array<{ section: keyof PersonalContextPack['sections']; text: string; kind?: PersonalContextFactKind }>;
  evidence?: Array<ClaimEvidenceRef | { span_id: string; quote: string; quote_hash?: string }>;
  maxAgeHours?: number;
  sourceTtlHours?: number;
};

const SECTION_ORDER: Array<keyof PersonalContextPack['sections']> = [
  'identity_constraints',
  'current_bets',
  'family_constraints',
  'decision_filters',
  'communication_preferences',
  'anti_patterns',
  'active_context',
];

const SECTION_LABELS: Record<keyof PersonalContextPack['sections'], string> = {
  identity_constraints: 'identity_constraints',
  current_bets: 'current_bets',
  family_constraints: 'family_constraints',
  decision_filters: 'decision_filters',
  communication_preferences: 'communication_preferences',
  anti_patterns: 'anti_patterns',
  active_context: 'active_context',
};

function toIso(value: string | Date | undefined, fallback = new Date()): string {
  if (!value) return fallback.toISOString();
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return fallback.toISOString();
  return date.toISOString();
}

function redactLocalPaths(text: string): string {
  return text
    .replace(/\/Users\/[^\s)]+/g, '$HOME')
    .replace(/\b[A-Za-z]:\\[^\s)]+/g, '$DRIVE')
    .replace(/\/[^\s)]+\/[^\s)]+/g, match => basename(match));
}

function splitItems(values: string[] = []): string[] {
  return values.map(v => String(v).trim()).filter(Boolean);
}

function evidenceFromRefs(refs: PersonalContextInput['evidence'] = []): PersonalContextEvidenceRef[] {
  return refs.map(ref => ({
    span_id: ref.span_id,
    quote: String(ref.quote || '').trim(),
    quote_hash: ref.quote_hash || hashQuote(String(ref.quote || '')),
    source_id: (ref as any).source_id,
    slug: (ref as any).slug,
    section: (ref as any).section,
    start_line: (ref as any).start_line,
    end_line: (ref as any).end_line,
  }));
}

function safeEvidenceRef(ref: ClaimEvidenceRef | PersonalContextEvidenceRef): PersonalContextEvidenceRef {
  return {
    span_id: ref.span_id,
    quote: redactLocalPaths(ref.quote),
    quote_hash: ref.quote_hash,
    source_id: ref.source_id,
    slug: ref.slug,
    section: ref.section,
    start_line: ref.start_line,
    end_line: ref.end_line,
  };
}

function withKind(text: string, kind: PersonalContextFactKind, evidenceSpanIds: string[], evidence: PersonalContextEvidenceRef[] = []): PersonalContextPackItem {
  return { text: redactLocalPaths(text), kind, evidence_span_ids: evidenceSpanIds, evidence: evidence.length > 0 ? evidence : undefined };
}

function appendItem(bucket: PersonalContextPack['sections'][keyof PersonalContextPack['sections']], item: PersonalContextPackItem): void {
  bucket.push(item);
}

function inferSectionFromSnippet(section: keyof PersonalContextPack['sections'], text: string, kind: PersonalContextFactKind): PersonalContextPackItem {
  return withKind(text, kind, [], []);
}

export function buildPersonalContextPack(input: PersonalContextInput): PersonalContextPack {
  const generatedAt = toIso(input.generatedAt);
  const subject = redactLocalPaths(input.subject || 'Aditya');
  const warnings: string[] = [];
  const evidenceRefs = evidenceFromRefs(input.evidence || []).map(safeEvidenceRef);
  const evidenceIndex = new Map<string, PersonalContextPack['evidence_index'][number]>();

  const sections: PersonalContextPack['sections'] = {
    identity_constraints: [],
    current_bets: [],
    family_constraints: [],
    decision_filters: [],
    communication_preferences: [],
    anti_patterns: [],
    active_context: [],
  };

  const addToSection = (section: keyof PersonalContextPack['sections'], text: string, kind: PersonalContextFactKind, evidenceSpanIds: string[], evidence: PersonalContextEvidenceRef[] = []) => {
    const item = withKind(text, kind, evidenceSpanIds, evidence);
    sections[section].push(item);
    for (const ev of evidence) {
      const existing = evidenceIndex.get(ev.span_id);
      if (existing) {
        for (const id of evidenceSpanIds) if (!existing.item_ids.includes(id)) existing.item_ids.push(id);
        continue;
      }
      evidenceIndex.set(ev.span_id, { ...ev, item_ids: [...evidenceSpanIds] });
    }
  };

  for (const fact of splitItems(input.facts)) {
    warnings.push(`fact requires evidence ref: ${fact}`);
  }

  const factsWithEvidence = evidenceRefs.slice();
  if (factsWithEvidence.length === 0 && splitItems(input.facts).length > 0) {
    warnings.push('facts supplied without evidence refs; compile as labeled inference-only skeleton');
  }

  for (const text of splitItems(input.preferences)) {
    addToSection('communication_preferences', text, 'preference', []);
  }
  for (const text of splitItems(input.inferences)) {
    addToSection('active_context', text, 'inference', []);
  }

  for (const snippet of input.snippets || []) {
    addToSection(snippet.section, snippet.text, snippet.kind || 'inference', []);
  }

  if (factsWithEvidence.length > 0) {
    addToSection('identity_constraints', 'Chief context must remain evidence-addressable and locally governed.', 'fact', factsWithEvidence.map(ev => ev.span_id), factsWithEvidence);
  }

  const localOnlyNote = 'Local-only compilation; no model API calls, trusted writes, or external messages.';
  addToSection('decision_filters', localOnlyNote, 'inference', []);
  addToSection('anti_patterns', 'Do not confuse synthetic scaffolding with canonical memory.', 'inference', []);
  addToSection('anti_patterns', 'Do not let a personal pack hardcode private facts without evidence refs.', 'inference', [], []);

  const freshnessHours = input.sourceTtlHours ?? 24;
  const maxAgeHours = input.maxAgeHours ?? 24;
  const staleAfter = new Date(Date.parse(generatedAt) - maxAgeHours * 60 * 60 * 1000).toISOString();

  return {
    schema: PERSONAL_CONTEXT_PACK_SCHEMA,
    profile: input.profile || 'aditya',
    task: input.task,
    subject,
    generated_at: generatedAt,
    sections,
    evidence_index: Array.from(evidenceIndex.values()),
    metadata: {
      privacy: 'local_only',
      freshness: {
        generated_at: generatedAt,
        max_age_hours: maxAgeHours,
        source_ttl_hours: freshnessHours,
        stale_after: staleAfter,
      },
      guardrails: {
        deterministic: true,
        local_only: true,
        trusted_pages_edited: false,
        external_messages_sent: false,
        global_config_changed: false,
        model_api_calls: false,
        no_private_fact_hardcoding: true,
      },
    },
    warnings,
  };
}

export function buildDeterministicPersonalContextPack(input: PersonalContextInput): PersonalContextPack {
  return buildPersonalContextPack(input);
}

export function validatePersonalContextPack(pack: unknown): string[] {
  const errors: string[] = [];
  const obj = pack as any;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['pack must be an object'];
  if (obj.schema !== PERSONAL_CONTEXT_PACK_SCHEMA) errors.push(`schema must be ${PERSONAL_CONTEXT_PACK_SCHEMA}`);
  if (obj.profile !== 'aditya') errors.push('profile must be aditya');
  if (!['meeting_brief', 'opportunity_eval', 'strategy_review', 'memory_answer'].includes(obj.task)) errors.push('task must be one of meeting_brief, opportunity_eval, strategy_review, memory_answer');
  if (typeof obj.subject !== 'string' || !obj.subject.trim()) errors.push('subject must be a non-empty string');
  if (typeof obj.generated_at !== 'string' || Number.isNaN(Date.parse(obj.generated_at))) errors.push('generated_at must be ISO-like timestamp');
  if (!obj.sections || typeof obj.sections !== 'object') errors.push('sections must be present');
  for (const section of SECTION_ORDER) {
    const value = obj.sections?.[section];
    if (!Array.isArray(value)) errors.push(`sections.${section} must be an array`);
    else {
      value.forEach((item: any, idx: number) => {
        const prefix = `sections.${section}[${idx}]`;
        if (!item || typeof item !== 'object') {
          errors.push(`${prefix} must be an object`);
          return;
        }
        if (typeof item.text !== 'string' || !item.text.trim()) errors.push(`${prefix}.text must be a non-empty string`);
        if (!['fact', 'preference', 'inference'].includes(item.kind)) errors.push(`${prefix}.kind must be fact, preference, or inference`);
        if (!Array.isArray(item.evidence_span_ids)) errors.push(`${prefix}.evidence_span_ids must be an array`);
        else if (item.kind === 'fact' && item.evidence_span_ids.length === 0) errors.push(`${prefix}.fact entries require evidence_span_ids`);
        if (item.evidence !== undefined) {
          if (!Array.isArray(item.evidence)) errors.push(`${prefix}.evidence must be an array when present`);
          else {
            item.evidence.forEach((ev: any, evIdx: number) => {
              const evPrefix = `${prefix}.evidence[${evIdx}]`;
              if (!ev || typeof ev !== 'object') {
                errors.push(`${evPrefix} must be an object`);
                return;
              }
              if (typeof ev.span_id !== 'string' || !ev.span_id.startsWith('gbs1:')) errors.push(`${evPrefix}.span_id must be a gbs1 span id`);
              if (typeof ev.quote !== 'string' || !ev.quote.trim()) errors.push(`${evPrefix}.quote must be a non-empty string`);
              if (typeof ev.quote_hash !== 'string' || ev.quote_hash !== hashQuote(ev.quote)) errors.push(`${evPrefix}.quote_hash must match quote`);
            });
          }
        }
      });
    }
  }
  if (!obj.metadata || typeof obj.metadata !== 'object') errors.push('metadata must be present');
  else {
    if (obj.metadata.privacy !== 'local_only') errors.push('metadata.privacy must be local_only');
    const freshness = obj.metadata.freshness;
    if (!freshness || typeof freshness !== 'object') errors.push('metadata.freshness must be present');
    else {
      if (typeof freshness.generated_at !== 'string' || Number.isNaN(Date.parse(freshness.generated_at))) errors.push('metadata.freshness.generated_at must be ISO-like');
      if (typeof freshness.stale_after !== 'string' || Number.isNaN(Date.parse(freshness.stale_after))) errors.push('metadata.freshness.stale_after must be ISO-like');
    }
    const guardrails = obj.metadata.guardrails;
    if (!guardrails || typeof guardrails !== 'object') errors.push('metadata.guardrails must be present');
    else {
      if (guardrails.trusted_pages_edited !== false) errors.push('metadata.guardrails.trusted_pages_edited must be false');
      if (guardrails.external_messages_sent !== false) errors.push('metadata.guardrails.external_messages_sent must be false');
      if (guardrails.global_config_changed !== false) errors.push('metadata.guardrails.global_config_changed must be false');
      if (guardrails.model_api_calls !== false) errors.push('metadata.guardrails.model_api_calls must be false');
      if (guardrails.no_private_fact_hardcoding !== true) errors.push('metadata.guardrails.no_private_fact_hardcoding must be true');
    }
  }
  return errors;
}
