import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import {
  classifyBookmarkItem,
  dedupeRawBookmarks,
  parseBookmarkMarkdown,
  type RawBookmarkItem,
  type StructuredBookmarkSignal,
} from '../../tasks/bookmarks-agent-core.ts';
import { enqueueWorkPacket, opsStorePath, type OpsWorkItem } from './kernel.ts';

export const OPS_BOOKMARK_ACTION_RADAR_SCHEMA = 'gbrain.ops.bookmark_action_radar.v1';
export const OPS_BOOKMARK_ACTION_DECISION_SCHEMA = 'gbrain.ops.bookmark_action_decision.v1';

export type BookmarkActionDecision = 'ignore' | 'archive' | 'remember' | 'investigate' | 'act' | 'interrupt';
export type BookmarkSourcePrivacy = 'P1_PRIVATE' | 'P2_LIMITED_CLOUD' | 'P3_PUBLIC';

export interface BookmarkActionRadarDecision {
  schema: typeof OPS_BOOKMARK_ACTION_DECISION_SCHEMA;
  id: string;
  bookmark_hash: string;
  url: string;
  title: string;
  platform: string;
  captured_at: string;
  decision: BookmarkActionDecision;
  score: number;
  reason: string;
  recommended_action: string;
  privacy_tier: BookmarkSourcePrivacy;
  review_only: true;
  trusted_personal_memory_mutated: false;
  external_action_taken: false;
  dedupe_key: string;
  created_at: string;
}

export interface BookmarkActionRadarReport {
  schema: typeof OPS_BOOKMARK_ACTION_RADAR_SCHEMA;
  ok: true;
  generated_at: string;
  input_count: number;
  deduped_count: number;
  decisions: BookmarkActionRadarDecision[];
  archived_decisions: BookmarkActionRadarDecision[];
  surfaced_candidates: BookmarkActionRadarDecision[];
  created_work_items: OpsWorkItem[];
  archive_path: string;
  thresholds: { surface_min_score: number; interrupt_min_score: number };
  safety: {
    review_only: true;
    trusted_personal_memory_mutated: false;
    external_action_taken: false;
    private_sources_require_local_or_review_only: true;
  };
}

export interface RunBookmarkActionRadarOptions {
  bookmarks: RawBookmarkItem[];
  storePath?: string;
  archivePath?: string;
  now?: Date;
  surfaceMinScore?: number;
  interruptMinScore?: number;
}

export function readBookmarkBatchFile(path: string): RawBookmarkItem[] {
  const raw = readFileSync(path, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('bookmark radar input JSON must be an array');
    return parsed.map(normalizeLooseBookmark).filter((item): item is RawBookmarkItem => !!item);
  }
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const maybeItems = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : Array.isArray(parsed.items) ? parsed.items : undefined;
    if (!maybeItems) throw new Error('bookmark radar input object must contain bookmarks[] or items[]');
    return maybeItems.map(normalizeLooseBookmark).filter((item): item is RawBookmarkItem => !!item);
  }
  return parseBookmarkMarkdown(raw);
}

export function runBookmarkActionRadar(options: RunBookmarkActionRadarOptions): BookmarkActionRadarReport {
  const now = options.now || new Date();
  const generatedAt = now.toISOString();
  const surfaceMinScore = options.surfaceMinScore ?? 70;
  const interruptMinScore = options.interruptMinScore ?? 90;
  const storePath = options.storePath || opsStorePath();
  const archivePath = options.archivePath || join(dirname(storePath), 'bookmark-action-decisions.jsonl');
  const bookmarks = dedupeRawBookmarks(options.bookmarks);
  const decisions = bookmarks.map(item => decideBookmarkAction(classifyBookmarkItem(item), now, { surfaceMinScore, interruptMinScore }));
  const archivedDecisions = decisions.filter(d => d.decision === 'ignore' || d.decision === 'archive');
  const surfacedCandidates = decisions
    .filter(d => d.score >= surfaceMinScore && ['investigate', 'act', 'interrupt'].includes(d.decision))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (archivedDecisions.length) appendDecisionArchive(archivePath, archivedDecisions);

  const actionable = decisions.filter(d => d.decision === 'investigate' || d.decision === 'act');
  const workPacket = actionable.length ? buildWorkPacket(actionable, generatedAt) : undefined;
  const createdWorkItems = workPacket ? enqueueWorkPacket(workPacket, { path: storePath, now }).work_items : [];

  return {
    schema: OPS_BOOKMARK_ACTION_RADAR_SCHEMA,
    ok: true,
    generated_at: generatedAt,
    input_count: options.bookmarks.length,
    deduped_count: bookmarks.length,
    decisions,
    archived_decisions: archivedDecisions,
    surfaced_candidates: surfacedCandidates,
    created_work_items: createdWorkItems,
    archive_path: archivePath,
    thresholds: { surface_min_score: surfaceMinScore, interrupt_min_score: interruptMinScore },
    safety: {
      review_only: true,
      trusted_personal_memory_mutated: false,
      external_action_taken: false,
      private_sources_require_local_or_review_only: true,
    },
  };
}

export function decideBookmarkAction(signal: StructuredBookmarkSignal, now = new Date(), thresholds: { surfaceMinScore?: number; interruptMinScore?: number } = {}): BookmarkActionRadarDecision {
  const text = `${signal.title} ${signal.content}`.toLowerCase();
  const privacy = classifyBookmarkPrivacy(signal);
  const score = scoreBookmarkSignal(signal);
  const interruptMinScore = thresholds.interruptMinScore ?? 90;
  let decision: BookmarkActionDecision;
  if (score >= interruptMinScore && signal.intent === 'actionable' && signal.confidence === 'high') decision = 'interrupt';
  else if (signal.intent === 'actionable') decision = score >= 80 ? 'act' : 'investigate';
  else if (signal.intent === 'watch') decision = score >= 65 ? 'investigate' : 'remember';
  else if (signal.intent === 'archive') decision = 'archive';
  else decision = 'ignore';

  if (privacy !== 'P3_PUBLIC' && decision === 'act') decision = 'investigate';
  if (privacy !== 'P3_PUBLIC' && decision === 'interrupt') decision = 'investigate';

  const privateNote = privacy !== 'P3_PUBLIC' ? ' Private or login-context source: keep review-only/local; do not send externally or mutate trusted memory.' : '';
  return {
    schema: OPS_BOOKMARK_ACTION_DECISION_SCHEMA,
    id: stableId('bookmark_decision', [signal.dedupeKey, decision, score]),
    bookmark_hash: signal.hash,
    url: signal.url,
    title: signal.title,
    platform: signal.platform,
    captured_at: signal.capturedAt,
    decision,
    score,
    reason: `${signal.whyItMatters}${privateNote}`,
    recommended_action: recommendedAction(decision, signal, text),
    privacy_tier: privacy,
    review_only: true,
    trusted_personal_memory_mutated: false,
    external_action_taken: false,
    dedupe_key: signal.dedupeKey,
    created_at: now.toISOString(),
  };
}

function scoreBookmarkSignal(signal: StructuredBookmarkSignal): number {
  const intent = { actionable: 72, watch: 55, archive: 20, ignore: 5 }[signal.intent];
  const type = { critical: 15, notable: 10, background: 0 }[signal.type];
  const confidence = { high: 12, medium: 7, low: 0 }[signal.confidence];
  const domain = { 'sovereign-ai': 8, 'judicial-ai': 8, gbrain: 7, 'local-llm': 6, personal: 0, other: 0 }[signal.domain];
  return Math.min(100, intent + type + confidence + domain);
}

function classifyBookmarkPrivacy(signal: StructuredBookmarkSignal): BookmarkSourcePrivacy {
  const url = signal.url.toLowerCase();
  if (url.includes('linkedin.com/feed') || url.includes('x.com/i/bookmarks') || url.includes('twitter.com/i/bookmarks')) return 'P1_PRIVATE';
  if (url.includes('linkedin.com') || url.includes('x.com') || url.includes('twitter.com')) return 'P2_LIMITED_CLOUD';
  return 'P3_PUBLIC';
}

function recommendedAction(decision: BookmarkActionDecision, signal: StructuredBookmarkSignal, text: string): string {
  if (decision === 'act') return `Create a bounded internal action plan from bookmark: ${signal.nextStep}`;
  if (decision === 'investigate') return `Run a review-only investigation of this saved item before any external action: ${signal.nextStep}`;
  if (decision === 'interrupt') return `Surface to Chief because it is high-confidence and time-sensitive/relevant: ${signal.nextStep}`;
  if (decision === 'remember') return 'Keep as a review-only memory/update proposal candidate; do not write trusted memory automatically.';
  if (decision === 'archive') return signal.nextStep;
  return text.includes('vendor') ? 'Ignore/archive vendor noise; no work item needed.' : signal.nextStep;
}

function buildWorkPacket(decisions: BookmarkActionRadarDecision[], generatedAt: string): { programs: unknown[]; work_items: unknown[] } {
  return {
    programs: [{
      id: 'bookmark-action-radar',
      title: 'Bookmark Action Radar',
      status: 'active',
      priority: 70,
      objective: 'Convert saved browser/social items into review-only internal work without external sends or trusted memory mutation.',
      lanes: ['intake', 'research', 'ops'],
      cadence: { trigger: 'bookmark_batch' },
      budgets: { max_external_actions: 0 },
      autonomy: { internal_ops_only: true, can_contact_people: false, can_mutate_trusted_memory: false },
      approval_gates: ['external_action', 'trusted_memory_mutation'],
      outputs: ['ops_work_items', 'decision_archive'],
      created_at: generatedAt,
      updated_at: generatedAt,
    }],
    work_items: decisions.map(d => ({
      id: stableId('bookmark_work', [d.dedupe_key, d.decision]),
      program_id: 'bookmark-action-radar',
      title: `${d.decision === 'act' ? 'Act on' : 'Investigate'} saved item: ${d.title}`.slice(0, 140),
      description: `${d.reason}\n\nRecommended action: ${d.recommended_action}\nSource: ${d.url}`,
      state: 'approved',
      priority: Math.max(55, d.score),
      lane: d.decision === 'act' ? 'ops' : 'research',
      worker_kind: d.privacy_tier === 'P1_PRIVATE' ? 'qwen_local' : 'subagent',
      privacy_tier: d.privacy_tier,
      source_refs: [{ kind: 'bookmark', url: d.url, title: d.title, hash: d.bookmark_hash, platform: d.platform, decision_id: d.id }],
      dependencies: [],
      acceptance_criteria: [
        'Summarize what the saved item changes for Chief or active workstreams.',
        'Use review-only outputs; do not contact anyone, post, send, purchase, crawl broadly, or mutate trusted memory.',
        'If a memory update seems useful, produce a proposal only.',
      ],
      expected_artifacts: ['brief_or_action_plan'],
      guardrails: [
        'No external sends/actions.',
        'No trusted personal memory mutation.',
        'Respect private/login-context source boundary.',
      ],
      approval_gates: ['external_action', 'trusted_memory_mutation'],
      budget: { max_minutes: 45, max_external_fetches: 0 },
      created_by: 'bookmark-action-radar',
      created_at: generatedAt,
      updated_at: generatedAt,
      last_state_reason: 'bookmark radar created review-only investigate/act work item',
    })),
  };
}

function appendDecisionArchive(path: string, decisions: BookmarkActionRadarDecision[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, decisions.map(d => JSON.stringify(d)).join('\n') + '\n', { flag: 'a' });
}

function normalizeLooseBookmark(input: unknown): RawBookmarkItem | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url : '';
  const title = typeof r.title === 'string' ? r.title : url;
  const content = typeof r.content === 'string' ? r.content : typeof r.text === 'string' ? r.text : typeof r.excerpt === 'string' ? r.excerpt : '';
  const platform = typeof r.platform === 'string' ? r.platform : inferPlatform(url);
  if (!url || !content) return null;
  return {
    url,
    title,
    content,
    hash: typeof r.hash === 'string' ? r.hash : stableId('bookmark_hash', [url, title, content]),
    platform,
    capturedAt: typeof r.capturedAt === 'string' ? r.capturedAt : typeof r.captured_at === 'string' ? r.captured_at : typeof r.ts === 'string' ? r.ts : '',
  };
}

function inferPlatform(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0] || 'web'; } catch { return 'web'; }
}

function stableId(prefix: string, parts: unknown): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)}`;
}
