import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { appendActionProposal, buildActionProposal, type ActionProposal } from '../actions/proposals.ts';
import { enqueueWorkPacket, opsStorePath, type OpsWorkItem } from './kernel.ts';

export const OPS_MEETING_TRANSCRIPT_ACTIONS_SCHEMA = 'gbrain.ops.meeting_transcript_actions.v1';
export const OPS_MEETING_TRANSCRIPT_ITEM_SCHEMA = 'gbrain.ops.meeting_transcript_item.v1';
export const OPS_MEETING_MEMORY_PROPOSAL_SCHEMA = 'gbrain.ops.meeting_memory_proposal.v1';

export type MeetingTranscriptItemKind = 'commitment' | 'follow_up' | 'reminder';
export type MeetingTranscriptPrivacy = 'P0_LOCAL_ONLY' | 'P1_PRIVATE';

export interface MeetingTranscriptLine {
  line: number;
  speaker?: string;
  text: string;
}

export interface MeetingExtractionRoute {
  provider: 'local-qwen';
  model: string;
  privacy_tier: MeetingTranscriptPrivacy;
  local_only: true;
  cloud_allowed: false;
  deterministic_stub: boolean;
}

export interface MeetingTranscriptItem {
  schema: typeof OPS_MEETING_TRANSCRIPT_ITEM_SCHEMA;
  id: string;
  kind: MeetingTranscriptItemKind;
  owner: string;
  text: string;
  counterparties: string[];
  due_hint?: string;
  evidence: { ref: string; quote: string; line: number; speaker?: string }[];
  confidence: number;
  approval_required_before_external_action: boolean;
  created_at: string;
}

export interface MeetingMemoryProposal {
  schema: typeof OPS_MEETING_MEMORY_PROPOSAL_SCHEMA;
  id: string;
  proposal_type: 'memory_review_candidate';
  claim: string;
  subject_entities: string[];
  evidence: { ref: string; quote: string; line: number; speaker?: string }[];
  sensitivity: 'P1';
  suggested_namespace: 'personal';
  review_only: true;
  trusted_personal_memory_mutated: false;
  created_at: string;
}

export interface MeetingTranscriptActionReport {
  schema: typeof OPS_MEETING_TRANSCRIPT_ACTIONS_SCHEMA;
  ok: true;
  generated_at: string;
  transcript_ref: string;
  route: MeetingExtractionRoute;
  commitments: MeetingTranscriptItem[];
  follow_ups: MeetingTranscriptItem[];
  reminders: MeetingTranscriptItem[];
  memory_proposals: MeetingMemoryProposal[];
  follow_up_action_proposals: ActionProposal[];
  created_work_items: OpsWorkItem[];
  archive_path: string;
  safety: {
    local_private_processing: true;
    provider_required: 'local-qwen';
    follow_up_drafts_require_approval: true;
    external_messages_sent: false;
    calendar_events_created: false;
    trusted_personal_memory_mutated: false;
    memory_output_review_only: true;
  };
}

export interface MeetingTranscriptExtractionProvider {
  readonly route: MeetingExtractionRoute;
  extract(input: { transcript: string; transcriptRef: string; now: Date }): Pick<MeetingTranscriptActionReport, 'commitments' | 'follow_ups' | 'reminders' | 'memory_proposals'>;
}

export interface RunMeetingTranscriptActionsOptions {
  transcript: string;
  transcriptRef?: string;
  storePath?: string;
  archivePath?: string;
  actionProposalPath?: string;
  now?: Date;
  provider?: MeetingTranscriptExtractionProvider;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, parts: unknown): string { return `${prefix}_${sha(JSON.stringify(parts)).slice(0, 14)}`; }
function clean(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function uniq(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))]; }

export function readMeetingTranscriptFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export function defaultMeetingTranscriptActionsArchivePath(storePath = opsStorePath()): string {
  return join(dirname(storePath), 'meeting-transcript-actions.jsonl');
}

export function localQwenMeetingExtractionRoute(privacy: MeetingTranscriptPrivacy = 'P1_PRIVATE'): MeetingExtractionRoute {
  return {
    provider: 'local-qwen',
    model: 'qwen-local-deterministic-transcript-actions-v1',
    privacy_tier: privacy,
    local_only: true,
    cloud_allowed: false,
    deterministic_stub: true,
  };
}

export function deterministicLocalQwenTranscriptProvider(privacy: MeetingTranscriptPrivacy = 'P1_PRIVATE'): MeetingTranscriptExtractionProvider {
  return {
    route: localQwenMeetingExtractionRoute(privacy),
    extract({ transcript, transcriptRef, now }) {
      return extractMeetingTranscriptDeterministically(transcript, transcriptRef, now);
    },
  };
}

export function runMeetingTranscriptActions(options: RunMeetingTranscriptActionsOptions): MeetingTranscriptActionReport {
  const now = options.now || new Date();
  const generatedAt = now.toISOString();
  const storePath = options.storePath || opsStorePath();
  const archivePath = options.archivePath || defaultMeetingTranscriptActionsArchivePath(storePath);
  const transcriptRef = options.transcriptRef || `transcript:${sha(options.transcript).slice(0, 12)}`;
  const provider = options.provider || deterministicLocalQwenTranscriptProvider('P1_PRIVATE');
  enforceLocalQwenRoute(provider.route);

  const extracted = provider.extract({ transcript: options.transcript, transcriptRef, now });
  const followUpActionProposals = extracted.follow_ups.map(item => buildFollowUpActionProposal(item, now));
  for (const proposal of followUpActionProposals) appendActionProposal(proposal, options.actionProposalPath);

  const actionableItems = [...extracted.commitments, ...extracted.follow_ups, ...extracted.reminders];
  const packet = actionableItems.length ? buildMeetingWorkPacket(actionableItems, transcriptRef, generatedAt) : undefined;
  const createdWorkItems = packet ? enqueueWorkPacket(packet, { path: storePath, now }).work_items : [];

  const report: MeetingTranscriptActionReport = {
    schema: OPS_MEETING_TRANSCRIPT_ACTIONS_SCHEMA,
    ok: true,
    generated_at: generatedAt,
    transcript_ref: transcriptRef,
    route: provider.route,
    commitments: extracted.commitments,
    follow_ups: extracted.follow_ups,
    reminders: extracted.reminders,
    memory_proposals: extracted.memory_proposals,
    follow_up_action_proposals: followUpActionProposals,
    created_work_items: createdWorkItems,
    archive_path: archivePath,
    safety: {
      local_private_processing: true,
      provider_required: 'local-qwen',
      follow_up_drafts_require_approval: true,
      external_messages_sent: false,
      calendar_events_created: false,
      trusted_personal_memory_mutated: false,
      memory_output_review_only: true,
    },
  };
  appendReportArchive(archivePath, report);
  return report;
}

function enforceLocalQwenRoute(route: MeetingExtractionRoute): void {
  if (route.provider !== 'local-qwen' || route.local_only !== true || route.cloud_allowed !== false) {
    throw new Error('private meeting transcript extraction must route to local-qwen with local_only=true and cloud_allowed=false');
  }
}

function extractMeetingTranscriptDeterministically(transcript: string, transcriptRef: string, now: Date): Pick<MeetingTranscriptActionReport, 'commitments' | 'follow_ups' | 'reminders' | 'memory_proposals'> {
  const lines = parseTranscriptLines(transcript);
  const commitments: MeetingTranscriptItem[] = [];
  const followUps: MeetingTranscriptItem[] = [];
  const reminders: MeetingTranscriptItem[] = [];
  const memoryProposals: MeetingMemoryProposal[] = [];

  for (const line of lines) {
    const lower = line.text.toLowerCase();
    const evidence = [{ ref: `${transcriptRef}:L${line.line}`, quote: line.text, line: line.line, speaker: line.speaker }];
    const counterparties = extractPeople(line.text, line.speaker);
    const dueHint = extractDueHint(line.text);

    if (isFollowUpLine(lower)) {
      followUps.push({ schema: OPS_MEETING_TRANSCRIPT_ITEM_SCHEMA, id: stableId('mtg_follow', [transcriptRef, line.line, line.text]), kind: 'follow_up', owner: ownerFor(line), text: normalizeActionText(line.text), counterparties, due_hint: dueHint, evidence, confidence: 0.82, approval_required_before_external_action: true, created_at: now.toISOString() });
      continue;
    }
    if (isCommitmentLine(lower)) {
      commitments.push({ schema: OPS_MEETING_TRANSCRIPT_ITEM_SCHEMA, id: stableId('mtg_commit', [transcriptRef, line.line, line.text]), kind: 'commitment', owner: ownerFor(line), text: normalizeActionText(line.text), counterparties, due_hint: dueHint, evidence, confidence: 0.78, approval_required_before_external_action: true, created_at: now.toISOString() });
      continue;
    }
    if (isReminderLine(lower)) {
      reminders.push({ schema: OPS_MEETING_TRANSCRIPT_ITEM_SCHEMA, id: stableId('mtg_remind', [transcriptRef, line.line, line.text]), kind: 'reminder', owner: 'Chief', text: normalizeActionText(line.text), counterparties, due_hint: dueHint, evidence, confidence: 0.76, approval_required_before_external_action: true, created_at: now.toISOString() });
    }
    const memoryClaim = memoryClaimFromLine(line.text);
    if (memoryClaim) {
      memoryProposals.push({ schema: OPS_MEETING_MEMORY_PROPOSAL_SCHEMA, id: stableId('mtg_mem', [transcriptRef, line.line, memoryClaim]), proposal_type: 'memory_review_candidate', claim: memoryClaim, subject_entities: uniq(['Chief', ...counterparties]), evidence, sensitivity: 'P1', suggested_namespace: 'personal', review_only: true, trusted_personal_memory_mutated: false, created_at: now.toISOString() });
    }
  }

  return { commitments: dedupeItems(commitments), follow_ups: dedupeItems(followUps), reminders: dedupeItems(reminders), memory_proposals: dedupeMemory(memoryProposals) };
}

function parseTranscriptLines(transcript: string): MeetingTranscriptLine[] {
  return transcript.split(/\r?\n/).map((raw, idx) => {
    const stripped = raw.replace(/^[-*]\s*/, '').trim();
    const match = stripped.match(/^(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?([^:]{1,40}):\s*(.+)$/);
    return match ? { line: idx + 1, speaker: clean(match[1]), text: clean(match[2]) } : { line: idx + 1, text: clean(stripped) };
  }).filter(l => l.text.length > 0 && !l.text.startsWith('#'));
}

function isFollowUpLine(lower: string): boolean {
  if (/\b(remember that|note that|preference:)\b/.test(lower)) return false;
  return /\b(follow up with|follow-up with|email|send|reply to|ping|message|share .* with|introduce .* to)\b/.test(lower) && !/\b(no need to|do not|don't)\b/.test(lower);
}

function isCommitmentLine(lower: string): boolean {
  return /\b(i will|i'll|we will|we'll|chief will|aditya will|action item|todo|to-do|need to|needs to|should)\b/.test(lower) && !/\b(no action|not needed|ignore)\b/.test(lower);
}

function isReminderLine(lower: string): boolean {
  return /\b(remind me|reminder|revisit|check back|circle back|by monday|by tuesday|by wednesday|by thursday|by friday|tomorrow|next week)\b/.test(lower);
}

function ownerFor(line: MeetingTranscriptLine): string {
  const speaker = (line.speaker || '').toLowerCase();
  const text = line.text.toLowerCase();
  if (speaker.includes('aditya') || speaker.includes('chief') || /\b(i will|i'll)\b/.test(text)) return 'Chief';
  if (speaker) return line.speaker || 'unknown';
  return /\bchief|aditya\b/.test(text) ? 'Chief' : 'unknown';
}

function extractPeople(text: string, speaker?: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\b(?:with|to|for|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)) found.push(match[1]);
  if (speaker && !/^(chief|aditya|me|i)$/i.test(speaker)) found.push(speaker);
  return uniq(found).slice(0, 6);
}

function extractDueHint(text: string): string | undefined {
  const match = text.match(/\b(by\s+(?:EOD|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s+\w+)|tomorrow|next week)\b/i);
  return match ? clean(match[0]) : undefined;
}

function normalizeActionText(text: string): string {
  return clean(text.replace(/^action item\s*[:\-]\s*/i, '').replace(/^todo\s*[:\-]\s*/i, ''));
}

function memoryClaimFromLine(text: string): string | undefined {
  const match = text.match(/\b(?:remember that|note that|important context:|chief prefers|preference:)\s*(.+)$/i);
  if (!match) return undefined;
  const claim = clean(match[1]);
  return claim.length >= 8 ? claim : undefined;
}

function dedupeItems<T extends MeetingTranscriptItem>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => { const key = `${item.kind}:${item.text.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function dedupeMemory(items: MeetingMemoryProposal[]): MeetingMemoryProposal[] {
  const seen = new Set<string>();
  return items.filter(item => { const key = item.claim.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function buildFollowUpActionProposal(item: MeetingTranscriptItem, now: Date): ActionProposal {
  const counterparty = item.counterparties[0] ? ` to ${item.counterparties[0]}` : '';
  return buildActionProposal({
    actionType: 'draft_email',
    title: `Draft follow-up${counterparty}: ${item.text}`.slice(0, 180),
    rationale: 'Meeting transcript contained a follow-up commitment. Drafting is local/review-only; sending requires explicit human approval.',
    expectedValue: 'Prepares a follow-up draft while preserving the external-send approval gate.',
    evidence: item.evidence.map(e => ({ ref: e.ref, quote: e.quote, observed_at: item.created_at })),
    owner: 'Chief',
    source: { kind: 'manual', id: item.id },
    now,
  });
}

function buildMeetingWorkPacket(items: MeetingTranscriptItem[], transcriptRef: string, generatedAt: string): { programs: unknown[]; work_items: unknown[] } {
  return {
    programs: [{
      id: 'meeting-transcript-actions',
      title: 'Meeting Transcript Action Extraction',
      status: 'active',
      priority: 80,
      objective: 'Convert private meeting transcripts into local-only commitments, follow-up drafts requiring approval, reminders, and review-only memory proposals.',
      lanes: ['private_extraction', 'action', 'reminder'],
      cadence: { trigger: 'meeting_transcript' },
      budgets: { max_external_actions: 0 },
      autonomy: { internal_ops_only: true, can_contact_people: false, can_mutate_trusted_memory: false },
      approval_gates: ['external_send', 'calendar_event', 'trusted_memory_write'],
      outputs: ['ops_work_items', 'pending_action_proposals', 'review_only_memory_proposals'],
      created_at: generatedAt,
      updated_at: generatedAt,
    }],
    work_items: items.map(item => ({
      id: stableId('meeting_work', [transcriptRef, item.id, item.kind]),
      program_id: 'meeting-transcript-actions',
      title: `${item.kind === 'follow_up' ? 'Draft approved follow-up' : item.kind === 'reminder' ? 'Reminder' : 'Commitment'}: ${item.text}`.slice(0, 140),
      description: `${item.text}\n\nEvidence: ${item.evidence.map(e => `${e.ref} “${e.quote}”`).join('; ')}${item.due_hint ? `\nDue hint: ${item.due_hint}` : ''}`,
      state: 'approved',
      priority: item.kind === 'follow_up' ? 82 : item.kind === 'commitment' ? 78 : 70,
      lane: item.kind === 'reminder' ? 'reminder' : 'action',
      lanes: ['private_extraction', item.kind === 'reminder' ? 'reminder' : 'action'],
      worker_kind: item.kind === 'reminder' ? 'human_review' : 'qwen_local',
      privacy_tier: 'P1_PRIVATE',
      source_refs: [{ kind: 'meeting_transcript', transcript_ref: transcriptRef, item_id: item.id, item_kind: item.kind, evidence: item.evidence }],
      dependencies: [],
      acceptance_criteria: [
        'Use local/private context only; do not send external messages or create calendar events.',
        'For follow-ups, create a draft/proposal only and keep explicit approval required before sending.',
        'For memory-worthy facts, produce review-only memory proposals; do not mutate trusted memory.',
      ],
      expected_artifacts: item.kind === 'reminder' ? ['reminder_record_or_review_note'] : ['draft_or_action_note'],
      guardrails: ['No external sends/actions.', 'No calendar writes.', 'No trusted personal memory mutation.', 'Private transcript content must remain local/review-only.'],
      approval_gates: ['external_send', 'calendar_event', 'trusted_memory_write'],
      budget: { max_minutes: 30, max_external_fetches: 0 },
      not_before: undefined,
      deadline_at: undefined,
      created_by: 'meeting-transcript-actions',
      created_at: generatedAt,
      updated_at: generatedAt,
      last_state_reason: 'meeting transcript extraction created review-only work item/reminder',
    })),
  };
}

function appendReportArchive(path: string, report: MeetingTranscriptActionReport): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(report) + '\n', { mode: 0o600 });
}

export function writeMeetingTranscriptActionReport(path: string, report: MeetingTranscriptActionReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
}
