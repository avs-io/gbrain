import { createHash } from 'node:crypto';

import {
  buildScoutQueryPlan,
  buildScoutSignalFromSource,
  type ScoutQueryPlan,
  type ScoutRecipe,
  type ScoutSignal,
} from './pipeline.ts';
import {
  sourceSpanForWebText,
  webSourceItem,
  type SourceItemRecord,
  type SourceSpanRecord,
} from '../evidence/source-bridge.ts';

export type ScoutRunDepth = 'shallow' | 'standard';
export type ScoutProviderKind = 'fixture_public_sources' | 'public_search' | 'public_web_fetch';
export type ScoutRunStatus = 'dry_run' | 'completed' | 'completed_with_failures' | 'failed';

export interface PublicScoutSourceInput {
  source_url?: string;
  url?: string;
  source_title?: string;
  title?: string;
  published_at?: string;
  claim?: string;
  excerpt?: string;
  content?: string;
  entities?: string[];
  provider?: string;
  query_id?: string;
  privacy?: string;
  privacy_tier?: string;
  namespace?: string;
  public?: boolean;
  source_kind?: string;
}

export interface ScoutRunLedger {
  schema: 'gbrain.scout.run_ledger.v1';
  run_id: string;
  recipe_slug: string;
  depth: ScoutRunDepth;
  dry_run: boolean;
  provider: ScoutProviderKind;
  status: ScoutRunStatus;
  query_plan: ScoutQueryPlan;
  diagnostics: {
    accepted_sources: number;
    duplicate_sources: number;
    failed_sources: number;
    rejected_sources: number;
    source_items_created: number;
    source_spans_created: number;
    warnings: string[];
  };
  failures: Array<{ index?: number; url?: string; status: 'duplicate' | 'rejected' | 'failed'; message: string }>;
}

export interface ScoutRunReport {
  schema: 'gbrain.scout.run_report.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  recipe: ScoutRecipe;
  plan: ScoutQueryPlan;
  run_ledger: ScoutRunLedger;
  source_items: SourceItemRecord[];
  source_spans: SourceSpanRecord[];
  signal_count: number;
  signals: ScoutSignal[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(input: unknown): string {
  return sha256(JSON.stringify(input)).slice(0, 16);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim());
}

function normalizeSource(raw: unknown, index: number): Required<Pick<PublicScoutSourceInput, 'source_url' | 'source_title' | 'claim' | 'excerpt' | 'content'>> & PublicScoutSourceInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`sources[${index}] must be an object`);
  const source = raw as PublicScoutSourceInput;
  const source_url = typeof source.source_url === 'string' ? source.source_url.trim() : typeof source.url === 'string' ? source.url.trim() : '';
  const source_title = typeof source.source_title === 'string' ? source.source_title.trim() : typeof source.title === 'string' ? source.title.trim() : '';
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  const excerpt = typeof source.excerpt === 'string' ? source.excerpt.trim() : content.slice(0, 500).trim();
  const claim = typeof source.claim === 'string' ? source.claim.trim() : source_title || excerpt.slice(0, 160).trim();
  return { ...source, source_url, source_title, content: content || excerpt, excerpt, claim };
}

function rejectReason(source: PublicScoutSourceInput): string | undefined {
  const privacy = String(source.privacy_tier || source.privacy || '').trim();
  if (['P0', 'P1', 'P0_LOCAL_ONLY', 'P1_PRIVATE', 'private', 'personal'].includes(privacy)) return `scout runner accepts only public/P3 sources, got privacy=${privacy}`;
  if (source.namespace && !['world', 'scouts'].includes(String(source.namespace))) return `scout runner rejects non-public namespace=${source.namespace}`;
  if (source.public === false) return 'scout runner rejects sources marked public=false';
  if (source.source_kind && ['gmail', 'calendar', 'contacts', 'notes', 'gbrain_page', 'private'].includes(String(source.source_kind))) return `scout runner rejects private source_kind=${source.source_kind}`;
  if (!source.source_url) return 'public scout ingestion requires source_url/url';
  let parsed: URL;
  try { parsed = new URL(source.source_url); } catch { return `invalid public source URL: ${source.source_url}`; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `unsupported public source protocol: ${parsed.protocol}`;
  if (!source.excerpt && !source.content) return 'public scout ingestion requires excerpt or content';
  return undefined;
}

function spanRange(content: string, excerpt: string): { startChar: number; endChar: number; quote: string } {
  const quote = excerpt || content.slice(0, 500);
  const found = content.indexOf(quote);
  const startChar = found >= 0 ? found : 0;
  const endChar = Math.max(startChar + 1, startChar + quote.length);
  return { startChar, endChar, quote };
}

export function runPublicScout(input: {
  recipe: ScoutRecipe;
  sources?: unknown[];
  depth?: ScoutRunDepth;
  dryRun?: boolean;
  provider?: ScoutProviderKind;
  now?: Date;
}): ScoutRunReport {
  const depth = input.depth ?? 'shallow';
  const dryRun = Boolean(input.dryRun);
  const provider = input.provider ?? 'fixture_public_sources';
  const plan = buildScoutQueryPlan(input.recipe);
  const warnings = [
    'public-source-only scout runner; P0/P1/private sources are rejected before source item construction',
    'provider abstraction boundary only; tests use fixtures and do not perform broad crawling',
    'robots/crawler discipline: live public_web_fetch providers must enforce robots, rate limits, and explicit budgets before network fetch',
  ];
  const failures: ScoutRunLedger['failures'] = [];
  const source_items: SourceItemRecord[] = [];
  const source_spans: SourceSpanRecord[] = [];
  const signals: ScoutSignal[] = [];
  const seenUrls = new Set<string>();
  const seenContentHashes = new Set<string>();
  let duplicate_sources = 0;
  let rejected_sources = 0;
  let failed_sources = 0;

  if (!dryRun) {
    (input.sources || []).forEach((raw, index) => {
      try {
        const source = normalizeSource(raw, index);
        const rejection = rejectReason(source);
        if (rejection) {
          rejected_sources++;
          failures.push({ index, url: source.source_url, status: 'rejected', message: rejection });
          return;
        }
        const normalizedUrl = new URL(source.source_url).toString();
        const contentHash = sha256(source.content);
        if (seenUrls.has(normalizedUrl) || seenContentHashes.has(contentHash)) {
          duplicate_sources++;
          failures.push({ index, url: normalizedUrl, status: 'duplicate', message: seenUrls.has(normalizedUrl) ? 'duplicate source_url skipped' : 'duplicate content_hash skipped' });
          return;
        }
        seenUrls.add(normalizedUrl);
        seenContentHashes.add(contentHash);
        const item = webSourceItem({
          url: normalizedUrl,
          title: source.source_title || undefined,
          namespace: 'world',
          privacy: 'P3_PUBLIC',
          content_hash: contentHash,
          metadata: {
            scout_recipe: input.recipe.slug,
            provider: source.provider || provider,
            query_id: source.query_id,
            published_at: source.published_at,
          },
        });
        const range = spanRange(source.content, source.excerpt);
        const span = sourceSpanForWebText(item, {
          ...range,
          metadata: { scout_recipe: input.recipe.slug, provider: source.provider || provider, query_id: source.query_id },
        });
        const signal = buildScoutSignalFromSource({
          recipe: input.recipe,
          source: {
            source_url: normalizedUrl,
            source_title: source.source_title || undefined,
            published_at: typeof source.published_at === 'string' ? source.published_at : undefined,
            claim: source.claim,
            excerpt: range.quote,
            entities: asStringArray(source.entities),
          },
        });
        source_items.push(item);
        source_spans.push(span);
        signals.push(signal);
      } catch (error) {
        failed_sources++;
        failures.push({ index, status: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  const status: ScoutRunStatus = dryRun ? 'dry_run' : failed_sources > 0 || rejected_sources > 0 ? 'completed_with_failures' : 'completed';
  const ledger: ScoutRunLedger = {
    schema: 'gbrain.scout.run_ledger.v1',
    run_id: `scout_run_${stableId({ recipe: input.recipe.slug, depth, dryRun, provider, sourceCount: input.sources?.length || 0, now: input.now?.toISOString() || '' })}`,
    recipe_slug: input.recipe.slug,
    depth,
    dry_run: dryRun,
    provider,
    status,
    query_plan: plan,
    diagnostics: {
      accepted_sources: source_items.length,
      duplicate_sources,
      failed_sources,
      rejected_sources,
      source_items_created: source_items.length,
      source_spans_created: source_spans.length,
      warnings,
    },
    failures,
  };

  return {
    schema: 'gbrain.scout.run_report.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    recipe: input.recipe,
    plan,
    run_ledger: ledger,
    source_items,
    source_spans,
    signal_count: signals.length,
    signals,
  };
}
