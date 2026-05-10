import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { classifyBookmarkItem, dedupeRawBookmarks, type RawBookmarkItem } from '../../tasks/bookmarks-agent-core.ts';
import { sourceSpanForWebText, webSourceItem, type SourceItemRecord, type SourceSpanRecord } from '../evidence/source-bridge.ts';
import { extractTopicCandidatesFromSourceSpans, type TopicCandidateExtractionReport } from '../topics/extractor.ts';
import { enqueueWorkPacket, opsStorePath, readOpsState, type OpsTopicTrack, type OpsWorkItem } from './kernel.ts';
import { decideBookmarkAction, readBookmarkBatchFile, type BookmarkActionDecision, type BookmarkActionRadarDecision } from './bookmark-action-radar.ts';
import type { BrainEngine } from '../engine.ts';

export const OPS_BOOKMARK_DEEP_RADAR_SCHEMA = 'gbrain.ops.bookmark_deep_radar.v1';
export const OPS_BOOKMARK_DEEP_DECISION_SCHEMA = 'gbrain.ops.bookmark_deep_decision.v1';

export type BookmarkDeepSourceClass = 'article' | 'pdf' | 'github' | 'social_saved' | 'unknown';
export type BookmarkDeepFetchStatus = 'fetch_allowed' | 'fetch_skipped';
export type BookmarkDeepFetchReason = 'fixture_provided' | 'disabled' | 'manual' | 'robots' | 'policy' | 'private' | 'no_outbound_url' | 'no_fixture_content';

export interface BookmarkDeepInput extends RawBookmarkItem {
  outbound_url?: string;
  canonical_url?: string;
  outbound_title?: string;
  outbound_content?: string;
  outbound_content_path?: string;
  outbound_content_type?: string;
  source_class?: BookmarkDeepSourceClass;
  fetch_policy?: 'crawl_allowed' | 'public_page' | 'api' | 'rss' | 'manual' | 'disabled';
  robots_allowed?: boolean;
  topic_ids?: string[];
  topics?: string[];
}

export interface BookmarkFetchDecision {
  status: BookmarkDeepFetchStatus;
  reason: BookmarkDeepFetchReason;
  url?: string;
  canonical_url?: string;
  source_class: BookmarkDeepSourceClass;
  policy: string;
  robots_allowed?: boolean;
  live_fetch_performed: false;
}

export interface ParsedDeepContent {
  source_item: SourceItemRecord;
  source_spans: SourceSpanRecord[];
  title: string;
  summary: string;
  canonical_url: string;
  source_class: BookmarkDeepSourceClass;
}

export interface BookmarkTopicLink {
  topic_id: string;
  reason: string;
  matched_terms: string[];
}

export interface BookmarkDeepDecision extends Omit<BookmarkActionRadarDecision, 'schema'> {
  schema: typeof OPS_BOOKMARK_DEEP_DECISION_SCHEMA;
  fetch: BookmarkFetchDecision;
  source_class: BookmarkDeepSourceClass;
  canonical_url: string;
  summary?: string;
  evidence_refs: Array<{ source_span_id: string; source_item_id: string; quote: string }>;
  topic_links: BookmarkTopicLink[];
}

export interface BookmarkDeepRadarReport {
  schema: typeof OPS_BOOKMARK_DEEP_RADAR_SCHEMA;
  ok: true;
  generated_at: string;
  input_count: number;
  deduped_count: number;
  decisions: BookmarkDeepDecision[];
  source_items: SourceItemRecord[];
  source_spans: SourceSpanRecord[];
  topic_extractions: TopicCandidateExtractionReport[];
  archived_decisions: BookmarkDeepDecision[];
  surfaced_candidates: BookmarkDeepDecision[];
  created_work_items: OpsWorkItem[];
  artifact_path: string;
  safety: {
    review_only: true;
    trusted_personal_memory_mutated: false;
    external_action_taken: false;
    live_fetch_performed: false;
    private_sources_fail_closed: true;
  };
}

export interface RunBookmarkDeepRadarOptions {
  bookmarks: BookmarkDeepInput[];
  storePath?: string;
  artifactPath?: string;
  now?: Date;
  surfaceMinScore?: number;
  interruptMinScore?: number;
  topicTracks?: OpsTopicTrack[];
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 16)}`; }
function clean(value: unknown): string { return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function norm(value: unknown): string { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function words(value: unknown): string[] { return norm(value).split(/\s+/).filter(w => w.length >= 4 && !['this','that','with','from','have','will','into','about','source','bookmark','article','public'].includes(w)); }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }

export function bookmarkDeepRadarArtifactPath(baseDir = process.cwd()): string {
  return join(baseDir, 'ops', 'intelligence', 'bookmark-deep-radar.jsonl');
}

export function readBookmarkDeepRadarInputFile(path: string): BookmarkDeepInput[] {
  const raw = readFileSync(path, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return readBookmarkBatchFile(path) as BookmarkDeepInput[];
  const parsed = JSON.parse(trimmed);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.bookmarks) ? parsed.bookmarks : Array.isArray(parsed.items) ? parsed.items : undefined;
  if (!items) throw new Error('bookmark deep-radar input must be an array or contain bookmarks[]/items[]');
  return items.map((item: unknown) => normalizeDeepBookmark(item, dirname(path))).filter((item: BookmarkDeepInput | null): item is BookmarkDeepInput => !!item);
}

export function runBookmarkDeepRadar(options: RunBookmarkDeepRadarOptions): BookmarkDeepRadarReport {
  const now = options.now || new Date();
  const generatedAt = now.toISOString();
  const storePath = options.storePath || opsStorePath();
  const artifactPath = options.artifactPath || bookmarkDeepRadarArtifactPath();
  const rawBookmarks = dedupeRawBookmarks(options.bookmarks) as BookmarkDeepInput[];
  const topicTracks = options.topicTracks || safeReadTopicTracks(storePath);
  const parsed: ParsedDeepContent[] = [];
  const decisions: BookmarkDeepDecision[] = [];

  for (const item of rawBookmarks) {
    const fetch = decideOutboundFetch(item);
    const content = fetch.status === 'fetch_allowed' ? parseDeepContent(item, fetch) : undefined;
    if (content) parsed.push(content);
    const enriched: RawBookmarkItem = { ...item, content: clean(`${item.content}\n${content?.title || ''}\n${content?.summary || ''}\n${content?.source_spans.map(s => s.quote).join('\n') || ''}`) };
    const base = decideBookmarkAction(classifyBookmarkItem(enriched), now, { surfaceMinScore: options.surfaceMinScore, interruptMinScore: options.interruptMinScore });
    const topicLinks = linkTopics(item, content, topicTracks);
    decisions.push({
      ...base,
      schema: OPS_BOOKMARK_DEEP_DECISION_SCHEMA,
      id: stableId('bookmark_deep_decision', [base.id, fetch.status, content?.source_item.id || 'no-content']),
      fetch,
      source_class: content?.source_class || fetch.source_class,
      canonical_url: content?.canonical_url || fetch.canonical_url || item.outbound_url || item.canonical_url || item.url,
      summary: content?.summary,
      evidence_refs: content?.source_spans.map(s => ({ source_span_id: s.ref, source_item_id: s.source_item_id, quote: s.quote || '' })).filter(e => e.quote) || [],
      topic_links: topicLinks,
    });
  }

  const sourceItems = parsed.map(p => p.source_item);
  const sourceSpans = parsed.flatMap(p => p.source_spans);
  const topicExtractions = extractByTopic(decisions, sourceItems, sourceSpans, now);
  const archivedDecisions = decisions.filter(d => d.decision === 'ignore' || d.decision === 'archive');
  const surfacedCandidates = decisions.filter(d => d.score >= (options.surfaceMinScore ?? 70) && ['investigate', 'act', 'interrupt'].includes(d.decision as BookmarkActionDecision));
  const actionable = decisions.filter(d => d.decision === 'investigate' || d.decision === 'act' || (d.score >= 80 && d.topic_links.length > 0));
  const createdWorkItems = actionable.length ? enqueueWorkPacket(buildDeepWorkPacket(actionable, generatedAt), { path: storePath, now }).work_items : [];

  const report: BookmarkDeepRadarReport = {
    schema: OPS_BOOKMARK_DEEP_RADAR_SCHEMA,
    ok: true,
    generated_at: generatedAt,
    input_count: options.bookmarks.length,
    deduped_count: rawBookmarks.length,
    decisions,
    source_items: sourceItems,
    source_spans: sourceSpans,
    topic_extractions: topicExtractions,
    archived_decisions: archivedDecisions,
    surfaced_candidates: surfacedCandidates,
    created_work_items: createdWorkItems,
    artifact_path: artifactPath,
    safety: { review_only: true, trusted_personal_memory_mutated: false, external_action_taken: false, live_fetch_performed: false, private_sources_fail_closed: true },
  };
  appendBookmarkDeepRadarArtifact(report, artifactPath);
  return report;
}

export function decideOutboundFetch(item: BookmarkDeepInput): BookmarkFetchDecision {
  const url = item.outbound_url || item.canonical_url || item.url;
  const sourceClass = inferSourceClass(item, url);
  const policy = item.fetch_policy || 'crawl_allowed';
  const base = { url, canonical_url: safeCanonicalUrl(url), source_class: sourceClass, policy, robots_allowed: item.robots_allowed, live_fetch_performed: false as const };
  if (!item.outbound_url && !item.canonical_url && item.url === url && (item.platform === 'x' || item.platform === 'linkedin')) return { ...base, status: 'fetch_skipped', reason: 'no_outbound_url' };
  if (!isPublicHttpUrl(url)) return { ...base, status: 'fetch_skipped', reason: 'private' };
  if (policy === 'disabled') return { ...base, status: 'fetch_skipped', reason: 'disabled' };
  if (policy === 'manual') return { ...base, status: 'fetch_skipped', reason: 'manual' };
  if (item.robots_allowed === false) return { ...base, status: 'fetch_skipped', reason: 'robots' };
  if (!['crawl_allowed', 'public_page', 'api', 'rss'].includes(policy)) return { ...base, status: 'fetch_skipped', reason: 'policy' };
  if (!deepContent(item)) return { ...base, status: 'fetch_skipped', reason: 'no_fixture_content' };
  return { ...base, status: 'fetch_allowed', reason: 'fixture_provided' };
}

function parseDeepContent(item: BookmarkDeepInput, fetch: BookmarkFetchDecision): ParsedDeepContent | undefined {
  const raw = deepContent(item);
  if (!raw || !fetch.canonical_url) return undefined;
  const text = clean(raw);
  if (text.length < 20) return undefined;
  const title = clean(item.outbound_title || extractTitle(raw) || item.title || fetch.canonical_url).slice(0, 180);
  const canonical = fetch.canonical_url;
  const sourceItem = webSourceItem({ url: canonical, title, namespace: 'world', privacy: 'P3_PUBLIC', content: text, metadata: { source_class: fetch.source_class, bookmark_hash: item.hash, parser: 'bookmark_deep_fixture_v1' } });
  const selected = selectKeySpans(text, `${item.title} ${item.content}`);
  const sourceSpans = selected.map((quote, i) => {
    const start = text.indexOf(quote);
    return sourceSpanForWebText(sourceItem, { startChar: Math.max(0, start), endChar: Math.max(0, start) + quote.length, quote, metadata: { span_kind: i === 0 ? 'summary' : 'key_span', source_class: fetch.source_class } });
  });
  return { source_item: sourceItem, source_spans: sourceSpans, title, summary: selected[0] || text.slice(0, 240), canonical_url: canonical, source_class: fetch.source_class };
}

function extractByTopic(decisions: BookmarkDeepDecision[], sourceItems: SourceItemRecord[], sourceSpans: SourceSpanRecord[], now: Date): TopicCandidateExtractionReport[] {
  const reports: TopicCandidateExtractionReport[] = [];
  const topicIds = uniq(decisions.flatMap(d => d.topic_links.map(t => t.topic_id)));
  for (const topicId of topicIds) {
    const refs = new Set(decisions.filter(d => d.topic_links.some(t => t.topic_id === topicId)).flatMap(d => d.evidence_refs.map(e => e.source_span_id)));
    const spans = sourceSpans.filter(s => refs.has(s.ref));
    const itemIds = new Set(spans.map(s => s.source_item_id));
    if (!spans.length) continue;
    reports.push(extractTopicCandidatesFromSourceSpans({ topic_id: topicId, source_items: sourceItems.filter(i => itemIds.has(i.id)), source_spans: spans, now }));
  }
  return reports;
}

function buildDeepWorkPacket(decisions: BookmarkDeepDecision[], generatedAt: string): { programs: unknown[]; work_items: unknown[] } {
  return {
    programs: [{ id: 'bookmark-action-radar', title: 'Bookmark Action Radar', status: 'active', priority: 70, objective: 'Convert saved items and fixture-provided outbound content into review-only intelligence WorkItems.', lanes: ['intake', 'research', 'ops'], cadence: { trigger: 'bookmark_deep_batch' }, budgets: { max_external_actions: 0, max_live_fetches: 0 }, autonomy: { internal_ops_only: true, can_contact_people: false, can_mutate_trusted_memory: false }, approval_gates: ['external_action', 'trusted_memory_mutation', 'live_fetch'], outputs: ['source_items', 'source_spans', 'topic_candidates', 'ops_work_items'], created_at: generatedAt, updated_at: generatedAt }],
    work_items: decisions.map(d => ({
      id: stableId('bookmark_deep_work', [d.dedupe_key, d.decision, d.canonical_url]),
      program_id: 'bookmark-action-radar',
      title: `${d.decision === 'act' ? 'Act on' : 'Investigate'} deep-read bookmark: ${d.title}`.slice(0, 140),
      description: `${d.reason}\n\nSummary: ${d.summary || 'No fixture content parsed.'}\n\nRecommended action: ${d.recommended_action}\nSource: ${d.canonical_url}`,
      state: 'approved',
      priority: Math.max(60, d.score),
      lane: d.decision === 'act' ? 'ops' : 'research',
      worker_kind: d.privacy_tier === 'P3_PUBLIC' ? 'subagent' : 'qwen_local',
      privacy_tier: d.privacy_tier,
      source_refs: [{ kind: 'bookmark_deep_radar', decision_id: d.id, url: d.url, canonical_url: d.canonical_url, source_spans: d.evidence_refs.map(e => e.source_span_id), topic_links: d.topic_links }],
      dependencies: [],
      acceptance_criteria: ['Use parsed source spans as evidence.', 'Reduce the item into topic candidates, surfacing/action proposal, or explicit discard.', 'Do not crawl broadly, send externally, or mutate trusted memory.'],
      expected_artifacts: ['review_only_brief_or_action_plan', { outputs: ['source_items', 'source_spans', 'topic_candidates'], topic_links: d.topic_links.map(t => t.topic_id) }],
      guardrails: ['No external sends/actions.', 'No trusted personal memory mutation.', 'No live fetching unless separately authorized and policy-gated.'],
      approval_gates: ['external_action', 'trusted_memory_mutation', 'live_fetch'],
      budget: { max_minutes: 45, max_external_fetches: 0, fetch_decision: d.fetch },
      created_by: 'bookmark-deep-radar', created_at: generatedAt, updated_at: generatedAt, last_state_reason: 'bookmark deep radar created review-only investigate/act work item',
    })),
  };
}

function appendBookmarkDeepRadarArtifact(report: BookmarkDeepRadarReport, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'bookmark_deep_radar', report }) + '\n', { mode: 0o600 });
  return path;
}

function normalizeDeepBookmark(input: unknown, baseDir: string): BookmarkDeepInput | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const url = string(r.url);
  const title = string(r.title) || url;
  const content = string(r.content) || string(r.text) || string(r.excerpt);
  if (!url || !content) return null;
  const path = string(r.outbound_content_path) || string(r.content_path) || string(r.fixture_path);
  const outbound_content = string(r.outbound_content) || string(r.outboundContent) || string(r.fixture_content) || (path ? readFixturePath(path, baseDir) : '');
  return { url, title, content, hash: string(r.hash) || stableId('bookmark_hash', [url, title, content]), platform: string(r.platform) || inferPlatform(url), capturedAt: string(r.capturedAt) || string(r.captured_at) || string(r.ts), outbound_url: string(r.outbound_url) || string(r.outboundUrl), canonical_url: string(r.canonical_url) || string(r.canonicalUrl), outbound_title: string(r.outbound_title) || string(r.outboundTitle), outbound_content, outbound_content_path: path, outbound_content_type: string(r.outbound_content_type) || string(r.content_type) || string(r.mime_type), source_class: sourceClassValue(r.source_class), fetch_policy: fetchPolicyValue(r.fetch_policy), robots_allowed: typeof r.robots_allowed === 'boolean' ? r.robots_allowed : typeof r.robotsAllowed === 'boolean' ? r.robotsAllowed : undefined, topic_ids: stringArray(r.topic_ids), topics: stringArray(r.topics) };
}

function string(v: unknown): string { return typeof v === 'string' ? v : ''; }
function stringArray(v: unknown): string[] | undefined { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined; }
function sourceClassValue(v: unknown): BookmarkDeepSourceClass | undefined { return typeof v === 'string' && ['article','pdf','github','social_saved','unknown'].includes(v) ? v as BookmarkDeepSourceClass : undefined; }
function fetchPolicyValue(v: unknown): BookmarkDeepInput['fetch_policy'] { return typeof v === 'string' && ['crawl_allowed','public_page','api','rss','manual','disabled'].includes(v) ? v as BookmarkDeepInput['fetch_policy'] : undefined; }
function readFixturePath(path: string, baseDir: string): string { const p = path.startsWith('/') ? path : join(baseDir, path); return existsSync(p) ? readFileSync(p, 'utf8') : ''; }
function deepContent(item: BookmarkDeepInput): string {
  if (item.outbound_content) return item.outbound_content;
  if (item.outbound_content_path && existsSync(item.outbound_content_path)) return readFileSync(item.outbound_content_path, 'utf8');
  return '';
}
function safeCanonicalUrl(url: string): string | undefined { try { return new URL(url).toString(); } catch { return undefined; } }
function isPublicHttpUrl(url: string): boolean { try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) return false; const h = u.hostname.toLowerCase(); if (h === 'localhost' || h.endsWith('.local') || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; if (h.includes('linkedin.com') || h.includes('x.com') || h.includes('twitter.com')) return false; return true; } catch { return false; } }
function inferPlatform(url: string): string { try { const h = new URL(url).hostname; if (h.includes('x.com') || h.includes('twitter.com')) return 'x'; if (h.includes('linkedin.com')) return 'linkedin'; return 'web'; } catch { return 'web'; } }
function inferSourceClass(item: BookmarkDeepInput, url: string): BookmarkDeepSourceClass { if (item.source_class) return item.source_class; const hay = `${url} ${item.outbound_content_type || ''}`.toLowerCase(); if (hay.includes('github.com')) return 'github'; if (hay.includes('.pdf') || hay.includes('pdf')) return 'pdf'; if (item.platform === 'x' || item.platform === 'linkedin') return 'social_saved'; return 'article'; }
function extractTitle(raw: string): string { return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.trim() || /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() || ''; }
function selectKeySpans(text: string, hint: string): string[] { const hintWords = new Set(words(hint)); const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 360); const scored = sentences.map(s => ({ s, score: words(s).filter(w => hintWords.has(w)).length + (/\b(sovereign ai|indiaai|gbrain|openclaw|qwen|benchmark|policy|procurement|github|paper|pdf|court|judicial)\b/i.test(s) ? 3 : 0) })).sort((a,b) => b.score - a.score || a.s.length - b.s.length); return uniq(scored.filter(x => x.score > 0).map(x => x.s).concat(sentences.slice(0, 3))).slice(0, 4); }
function safeReadTopicTracks(storePath: string): OpsTopicTrack[] { try { return readOpsState(storePath).topic_tracks; } catch { return []; } }
function linkTopics(item: BookmarkDeepInput, content: ParsedDeepContent | undefined, tracks: OpsTopicTrack[]): BookmarkTopicLink[] { const explicit = [...(item.topic_ids || []), ...(item.topics || [])]; const text = `${item.title} ${item.content} ${content?.title || ''} ${content?.summary || ''} ${content?.source_spans.map(s => s.quote).join(' ') || ''}`; const links: BookmarkTopicLink[] = explicit.map(id => ({ topic_id: id, reason: 'explicit input topic link', matched_terms: [id] })); if (/\b(sovereign ai|indiaai|india ai mission|bharatgen|sarvam|meity)\b/i.test(text) && !links.some(l => l.topic_id === 'world-sovereign-ai-india')) links.push({ topic_id: 'world-sovereign-ai-india', reason: 'matched sovereign AI India terms', matched_terms: ['sovereign ai', 'indiaai'] }); for (const t of tracks) { const terms = uniq([t.title, ...t.watch_entities, ...t.seed_queries, ...t.source_classes].flatMap(words)); const matched = terms.filter(term => norm(text).includes(term)).slice(0, 8); if (matched.length >= 2 && !links.some(l => l.topic_id === t.id)) links.push({ topic_id: t.id, reason: 'matched TopicTrack terms', matched_terms: matched }); } return links.slice(0, 5); }

// ---------------------------------------------------------------------------
// GBrain page writing for remember/act decisions
// ---------------------------------------------------------------------------

export interface WriteBookmarkPagesOptions {
  decisions: BookmarkDeepDecision[];
  engine: BrainEngine;
  now?: Date;
}

export interface WriteBookmarkPagesResult {
  ok: boolean;
  pages_written: number;
  skipped_non_actionable: number;
  errors: string[];
}

/**
 * Write "remember" and "act" bookmark decisions as GBrain pages at:
 *   wiki/sources/bookmarks/{platform}/{author}/{slug}
 *
 * "investigate" decisions are NOT written as pages (they stay as work items).
 * This preserves the review-only safety boundary while making actionable
 * bookmarks permanently discoverable.
 */
export async function writeBookmarkPagesAsBrainPages(
  options: WriteBookmarkPagesOptions,
): Promise<WriteBookmarkPagesResult> {
  const { decisions, engine } = options;
  const now = options.now || new Date();
  const errors: string[] = [];
  let pagesWritten = 0;
  let skipped = 0;

  for (const decision of decisions) {
    if (decision.decision !== 'remember' && decision.decision !== 'act') {
      skipped++;
      continue;
    }

    try {
      const slug = slugForBookmarkDeepDecision(decision);
      const content = buildBookmarkPageContent(decision, now);
      const existing = await engine.getPage(slug);

      if (existing) {
        // Upsert: preserve existing timeline, update content
        await engine.putPage(slug, {
          type: existing.type,
          title: existing.title,
          compiled_truth: content.body,
          timeline: existing.timeline,
          frontmatter: {
            ...existing.frontmatter,
            ...content.frontmatter,
            updated: now.toISOString(),
            decision: decision.decision,
            score: decision.score,
          },
        });
      } else {
        // Create new page
        await engine.putPage(slug, {
          type: 'note',
          title: content.title,
          compiled_truth: content.body,
          timeline: '',
          frontmatter: {
            ...content.frontmatter,
            created: now.toISOString().split('T')[0],
            updated: now.toISOString(),
            source: 'bookmark-deep-radar',
            decision: decision.decision,
            score: decision.score,
            canonical_url: decision.canonical_url,
            platform: decision.platform,
            privacy_tier: decision.privacy_tier,
          },
        });
      }

      // Add timeline entry for this capture
      try {
        await engine.addTimelineEntry(slug, {
          date: now.toISOString().split('T')[0] ?? '',
          summary: `Bookmarked via deep-radar: decision=${decision.decision}, score=${decision.score}`,
          source: 'bookmark-deep-radar',
        });
      } catch { /* timeline add is best-effort */ }

      pagesWritten++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to write page for ${decision.id}: ${msg}`);
    }
  }

  return { ok: errors.length === 0, pages_written: pagesWritten, skipped_non_actionable: skipped, errors };
}

function slugForBookmarkDeepDecision(decision: BookmarkDeepDecision): string {
  const platform = decision.platform || 'web';
  const author = extractAuthorFromUrl(decision.canonical_url || decision.url, platform);
  const slugPart = extractSlugPart(decision.canonical_url || decision.url, decision.id);
  return `wiki/sources/bookmarks/${platform}/${author}/${slugPart}`;
}

function extractAuthorFromUrl(url: string, platform: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);

    if (platform === 'x' || platform === 'twitter') {
      // x.com/elonmusk/status/1234567890 -> elonmusk
      return parts[0]?.replace(/[^a-zA-Z0-9_]/g, '') || 'unknown';
    }
    if (platform === 'linkedin') {
      // linkedin.com/in/johndoe or linkedin.com/company/acme -> johndoe or acme
      const idx = parts.findIndex(p => p === 'in' || p === 'company');
      return idx >= 0 ? (parts[idx + 1]?.replace(/[^a-zA-Z0-9\-]/g, '') || 'unknown') : (parts[0]?.replace(/[^a-zA-Z0-9\-]/g, '') || 'unknown');
    }
    if (platform === 'github') {
      // github.com/owner/repo -> owner
      return parts[0]?.replace(/[^a-zA-Z0-9\-]/g, '') || 'unknown';
    }
    // Generic: first path component
    return parts[0]?.replace(/[^a-zA-Z0-9\-]/g, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractSlugPart(url: string, fallbackId: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      // For X status IDs, use the ID directly
      if (/^\d+$/.test(last)) return last;
      // Otherwise use the last meaningful segment
      return last.replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 60);
    }
    // Fallback to hostname + hash of path
    const hash = createHash('sha256').update(u.pathname).digest('hex').slice(0, 12);
    return `${u.hostname.replace(/[^a-zA-Z0-9]/g, '')}-${hash}`;
  } catch {
    return fallbackId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  }
}

interface PageContentResult {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

function buildBookmarkPageContent(decision: BookmarkDeepDecision, now: Date): PageContentResult {
  const date = now.toISOString().slice(0, 10);
  const score = decision.score;
  const decisionType = decision.decision;
  const sourceClass = decision.source_class || 'unknown';

  // Build key spans section
  const keySpans = decision.evidence_refs
    .map(ref => ref.quote)
    .filter(Boolean)
    .slice(0, 4)
    .map(q => `> ${q.replace(/\n/g, ' ').slice(0, 300)}`)
    .join('\n\n');

  // Build topic links section
  const topicSection = decision.topic_links.length
    ? `## Topic Links\n\n${decision.topic_links.map(t => `- [[${t.topic_id}]] — ${t.reason}`).join('\n')}\n`
    : '';

  // Build summary section
  const summarySection = decision.summary
    ? `## Summary\n\n${decision.summary}\n`
    : '';

  // Build recommended action
  const actionSection = decision.recommended_action
    ? `## Recommended Action\n\n${decision.recommended_action}\n`
    : '';

  const body = `# ${decision.title}\n\n**Platform:** ${decision.platform} | **Decision:** ${decisionType} | **Score:** ${score}\n**Captured:** ${date} | **Source Class:** ${sourceClass}\n\n${summarySection}${keySpans ? `## Key Spans\n\n${keySpans}\n` : ''}${topicSection}${actionSection}## Metadata\n\n- Decision ID: \`${decision.id}\`\n- Canonical URL: ${decision.canonical_url || decision.url}\n- Dedupe Key: \`${decision.dedupe_key}\`\n- Privacy Tier: \`${decision.privacy_tier}\`\n- Reason: ${decision.reason}\n\n---\n*Auto-generated by bookmark-deep-radar. Do not edit manually.*\n`;

  return {
    title: decision.title,
    body,
    frontmatter: {
      type: 'note',
      source: 'bookmark-deep-radar',
      decision: decisionType,
      score,
      platform: decision.platform,
      source_class: sourceClass,
      canonical_url: decision.canonical_url || decision.url,
      privacy_tier: decision.privacy_tier,
    },
  };
}
