import { createHash } from 'node:crypto';

import { isNamespace, isPrivacyTier, type Namespace, type PrivacyTier, type AuthorityTier } from '../intelligence/policy.ts';
import {
  buildSourceDocument,
  parseSpanId,
  showLines,
  type PageLike,
  type SourceWindow,
} from './source-window.ts';

export const SOURCE_ITEM_PAGE_PREFIX = 'page:';
export const SOURCE_ITEM_WEB_PREFIX = 'web:';
export const SOURCE_SPAN_BRIDGE_PREFIX = 'srcspan1:';

export type SourceItemKind = 'gbrain_page' | 'web_document' | 'public_document' | 'external_document';
export type SourceSpanRefKind = 'gbs1' | 'srcspan1';
export type SourceLineBasis = 'stored_section' | 'external_byte_range' | 'external_char_range' | 'external_selector';

export interface SourceItemRecord {
  id: string;
  kind: SourceItemKind;
  namespace: Namespace;
  privacy: PrivacyTier;
  authority: AuthorityTier;
  title?: string;
  source_id?: string;
  slug?: string;
  url?: string;
  media_type?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceSpanRecord {
  ref: string;
  ref_kind: SourceSpanRefKind;
  source_item_id: string;
  namespace: Namespace;
  privacy: PrivacyTier;
  authority: AuthorityTier;
  section?: string;
  start_line?: number;
  end_line?: number;
  start_char?: number;
  end_char?: number;
  selector?: string;
  quote?: string;
  quote_hash?: string;
  line_basis: SourceLineBasis;
  metadata?: Record<string, unknown>;
}

export interface ResolvedSourceSpan {
  item: SourceItemRecord;
  span: SourceSpanRecord;
  window?: SourceWindow;
}

export interface SourceBridgeEngine {
  executeRaw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface PageRow extends PageLike {
  id?: number;
  type?: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function quoteHash(quote: string): string {
  return sha256(quote);
}

export function sourceItemIdForPage(sourceId: string, slug: string): string {
  if (!sourceId || sourceId.includes('#')) throw new Error(`Invalid source item source_id: ${sourceId}`);
  if (!slug || slug.startsWith('/') || slug.includes('#') || slug.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid source item slug: ${slug}`);
  }
  return `${SOURCE_ITEM_PAGE_PREFIX}${sourceId}:${slug}`;
}

export function sourceItemIdForWeb(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Unsupported source item URL protocol: ${parsed.protocol}`);
  return `${SOURCE_ITEM_WEB_PREFIX}${sha256(parsed.toString()).slice(0, 24)}`;
}

export function pageSourceItemFromPage(page: PageLike, overrides: Partial<SourceItemRecord> = {}): SourceItemRecord {
  const sourceId = page.source_id ?? page.sourceId ?? 'default';
  return validateSourceItemRecord({
    id: sourceItemIdForPage(sourceId, page.slug),
    kind: 'gbrain_page',
    namespace: 'personal',
    privacy: 'P1_PRIVATE',
    authority: 'raw_source',
    source_id: sourceId,
    slug: page.slug,
    title: page.title ?? undefined,
    ...overrides,
  });
}

export function webSourceItem(input: { url: string; title?: string; namespace?: Namespace; privacy?: PrivacyTier; content?: string; content_hash?: string; metadata?: Record<string, unknown> }): SourceItemRecord {
  return validateSourceItemRecord({
    id: sourceItemIdForWeb(input.url),
    kind: 'web_document',
    namespace: input.namespace ?? 'world',
    privacy: input.privacy ?? 'P3_PUBLIC',
    authority: 'raw_source',
    url: new URL(input.url).toString(),
    title: input.title,
    content_hash: input.content_hash ?? (input.content ? sha256(input.content) : undefined),
    metadata: input.metadata,
  });
}

export function makeExternalSpanRef(sourceItemId: string, range: { startChar: number; endChar: number }): string {
  if (!sourceItemId || sourceItemId.includes('#')) throw new Error(`Invalid source item id for span ref: ${sourceItemId}`);
  if (!Number.isInteger(range.startChar) || !Number.isInteger(range.endChar) || range.startChar < 0 || range.endChar <= range.startChar) {
    throw new Error(`Invalid external span char range: ${range.startChar}-${range.endChar}`);
  }
  return `${SOURCE_SPAN_BRIDGE_PREFIX}${sourceItemId}#char:${range.startChar}-${range.endChar}`;
}

export function sourceSpanFromGbs1(spanId: string, window?: SourceWindow, itemOverrides: Partial<SourceItemRecord> = {}): SourceSpanRecord {
  const parsed = parseSpanId(spanId);
  const quote = window?.quote;
  return validateSourceSpanRecord({
    ref: spanId,
    ref_kind: 'gbs1',
    source_item_id: sourceItemIdForPage(parsed.sourceId, parsed.slug),
    namespace: itemOverrides.namespace ?? 'personal',
    privacy: itemOverrides.privacy ?? 'P1_PRIVATE',
    authority: 'source_span',
    section: parsed.section,
    start_line: parsed.startLine,
    end_line: parsed.endLine,
    quote,
    quote_hash: quote ? quoteHash(quote) : window?.quoteHash,
    line_basis: 'stored_section',
  });
}

export function sourceSpanForWebText(item: SourceItemRecord, input: { startChar: number; endChar: number; quote?: string; selector?: string; metadata?: Record<string, unknown> }): SourceSpanRecord {
  if (item.kind !== 'web_document' && item.kind !== 'public_document' && item.kind !== 'external_document') {
    throw new Error(`External text span requires external source item, got: ${item.kind}`);
  }
  return validateSourceSpanRecord({
    ref: makeExternalSpanRef(item.id, input),
    ref_kind: 'srcspan1',
    source_item_id: item.id,
    namespace: item.namespace,
    privacy: item.privacy,
    authority: 'source_span',
    start_char: input.startChar,
    end_char: input.endChar,
    selector: input.selector,
    quote: input.quote,
    quote_hash: input.quote ? quoteHash(input.quote) : undefined,
    line_basis: 'external_char_range',
    metadata: input.metadata,
  });
}

export function parseSourceSpanRef(ref: string): { ref_kind: SourceSpanRefKind; source_item_id?: string; start_char?: number; end_char?: number } {
  if (ref.startsWith('gbs1:')) return { ref_kind: 'gbs1' };
  if (ref.startsWith(SOURCE_SPAN_BRIDGE_PREFIX)) {
    const body = ref.slice(SOURCE_SPAN_BRIDGE_PREFIX.length);
    const match = /^(.+)#char:(\d+)-(\d+)$/.exec(body);
    if (!match) throw new Error(`Malformed source span ref: ${ref}`);
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (end <= start) throw new Error(`Invalid source span char range: ${ref}`);
    return { ref_kind: 'srcspan1', source_item_id: match[1], start_char: start, end_char: end };
  }
  throw new Error(`Unsupported source span ref: ${ref}`);
}

export function validateSourceItemRecord(record: SourceItemRecord): SourceItemRecord {
  if (!record.id || record.id.includes('#')) throw new Error(`Invalid source item id: ${record.id}`);
  if (!['gbrain_page', 'web_document', 'public_document', 'external_document'].includes(record.kind)) throw new Error(`Invalid source item kind: ${record.kind}`);
  if (!isNamespace(record.namespace)) throw new Error(`Invalid source item namespace: ${String(record.namespace)}`);
  if (!isPrivacyTier(record.privacy)) throw new Error(`Invalid source item privacy: ${String(record.privacy)}`);
  if (record.kind === 'gbrain_page') {
    if (!record.source_id || !record.slug) throw new Error('gbrain_page source item requires source_id and slug');
    if (record.id !== sourceItemIdForPage(record.source_id, record.slug)) throw new Error('gbrain_page source item id must match source_id and slug');
  }
  if ((record.kind === 'web_document' || record.kind === 'public_document') && !record.url) throw new Error(`${record.kind} source item requires url`);
  if (record.privacy === 'P3_PUBLIC' && record.namespace === 'personal') throw new Error('personal source items cannot be P3_PUBLIC');
  return record;
}

export function validateSourceSpanRecord(record: SourceSpanRecord): SourceSpanRecord {
  const parsed = parseSourceSpanRef(record.ref);
  if (record.ref_kind !== parsed.ref_kind) throw new Error('source span ref_kind does not match ref');
  if (!isNamespace(record.namespace)) throw new Error(`Invalid source span namespace: ${String(record.namespace)}`);
  if (!isPrivacyTier(record.privacy)) throw new Error(`Invalid source span privacy: ${String(record.privacy)}`);
  if (record.authority !== 'source_span') throw new Error('source span authority must be source_span');
  if (record.quote && record.quote_hash && quoteHash(record.quote) !== record.quote_hash) throw new Error('source span quote_hash must match quote');
  if (parsed.ref_kind === 'gbs1') {
    const span = parseSpanId(record.ref);
    if (record.source_item_id !== sourceItemIdForPage(span.sourceId, span.slug)) throw new Error('gbs1 source span item id must match source span source/slug');
    if (record.section !== span.section || record.start_line !== span.startLine || record.end_line !== span.endLine) throw new Error('gbs1 source span line metadata must match ref');
    if (record.line_basis !== 'stored_section') throw new Error('gbs1 source span line_basis must be stored_section');
  } else {
    if (record.source_item_id !== parsed.source_item_id) throw new Error('external source span item id must match ref');
    if (record.start_char !== parsed.start_char || record.end_char !== parsed.end_char) throw new Error('external source span char metadata must match ref');
    if (record.line_basis !== 'external_char_range' && record.line_basis !== 'external_byte_range' && record.line_basis !== 'external_selector') throw new Error(`Invalid external source span line_basis: ${record.line_basis}`);
  }
  return record;
}

async function loadPage(engine: SourceBridgeEngine, sourceId: string, slug: string): Promise<PageRow> {
  const rows = await engine.executeRaw<PageRow>(
    `SELECT p.id, p.slug, p.source_id, p.title, p.compiled_truth, p.timeline, p.type
       FROM pages p
      WHERE p.slug = $1 AND p.source_id = $2
      LIMIT 1`,
    [slug, sourceId],
  );
  if (rows.length === 0) throw new Error(`Source page not found: ${sourceId}:${slug}`);
  return rows[0];
}

export async function resolveSourceItem(engine: SourceBridgeEngine, id: string): Promise<SourceItemRecord> {
  if (id.startsWith(SOURCE_ITEM_PAGE_PREFIX)) {
    const body = id.slice(SOURCE_ITEM_PAGE_PREFIX.length);
    const sep = body.indexOf(':');
    if (sep < 1) throw new Error(`Malformed page source item id: ${id}`);
    const sourceId = body.slice(0, sep);
    const slug = body.slice(sep + 1);
    const page = await loadPage(engine, sourceId, slug);
    return pageSourceItemFromPage(page);
  }
  throw new Error(`Source item is not resolvable from trusted store yet: ${id}`);
}

export async function resolveSourceSpan(engine: SourceBridgeEngine, ref: string): Promise<ResolvedSourceSpan> {
  const parsed = parseSourceSpanRef(ref);
  if (parsed.ref_kind !== 'gbs1') throw new Error(`Source span ref is not resolvable from trusted store yet: ${ref}`);
  const span = parseSpanId(ref);
  const page = await loadPage(engine, span.sourceId, span.slug);
  const doc = buildSourceDocument(page);
  const window = showLines(doc, span.section, span.startLine, span.endLine);
  if (window.spanId !== ref) throw new Error(`Could not resolve source span exactly: requested ${ref}, resolved ${window.spanId}`);
  const item = pageSourceItemFromPage(page);
  const spanRecord = sourceSpanFromGbs1(ref, window, item);
  return { item, span: spanRecord, window };
}
