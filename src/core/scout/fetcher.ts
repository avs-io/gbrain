/**
 * WebFetcher — live URL content fetcher for scout source acquisition.
 *
 * Respects:
 * - robots.txt (via isBot/user-agent policy)
 * - per-target daily limits (via checkSourceTargetAllowed)
 * - per-domain rate limits (in-memory, resets per process)
 * - Fetch budget from track budgets
 *
 * Does NOT mutate trusted personal memory. Emits source_items + source_spans
 * via the ops store (scout_source_queue with status=fetched).
 */

import { createHash } from 'node:crypto';

import {
  decideSourceTargetFetch,
  type OpsSourceTarget,
  type OpsTopicTrack,
  readOpsState,
  upsertScoutSourceQueueItem,
  type OpsStoreOptions,
} from '../ops/kernel.ts';

export interface FetcherOptions {
  storePath?: string;
  /** Override max fetches per run. Defaults to track budgets or 10. */
  maxFetches?: number;
  /** Override: only fetch from these explicit URLs (bypasses source_targets). */
  urlList?: string[];
  /** If true, ignore robots.txt checks (for testing/internal nets). */
  ignoreRobots?: boolean;
  /** User-Agent string sent with requests. */
  userAgent?: string;
  /** Request timeout in ms. Default: 15000. */
  timeoutMs?: number;
  now?: Date;
}

export interface FetchResult {
  url: string;
  ok: boolean;
  content?: string;
  title?: string;
  published_at?: string;
  content_hash?: string;
  error?: string;
  robots_blocked?: boolean;
  rate_limited?: boolean;
  fetch_duration_ms?: number;
}

export interface FetchSummary {
  topic_track_id: string;
  topic: string;
  run_id: string;
  mode: 'live_fetch';
  fetches: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    robots_blocked: number;
    rate_limited: number;
  };
  results: FetchResult[];
  queued_items: number;
  warnings: string[];
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Domain rate limiter (in-memory, per-process)
// ---------------------------------------------------------------------------

const domainLastFetch = new Map<string, number>();
const DOMAIN_MIN_INTERVAL_MS = 2000; // 1 fetch per domain per 2 seconds minimum

function rateLimitDomain(domain: string): boolean {
  const now = Date.now();
  const last = domainLastFetch.get(domain);
  if (last !== undefined && now - last < DOMAIN_MIN_INTERVAL_MS) return true;
  domainLastFetch.set(domain, now);
  return false;
}

function domainOfUrl(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return 'unknown'; }
}

// ---------------------------------------------------------------------------
// robots.txt fetcher (lightweight, in-memory cache per process)
// ---------------------------------------------------------------------------

interface RobotsEntry {
  allowed: Set<string>;
  disallow: Set<string>;
  cached_at: number;
}

const robotsCache = new Map<string, RobotsEntry>();
const ROBOTS_CACHE_TTL_MS = 3600_000; // 1 hour

async function fetchRobotsTxt(baseUrl: string, userAgent: string, timeoutMs: number): Promise<RobotsEntry> {
  const cached = robotsCache.get(baseUrl);
  if (cached && Date.now() - cached.cached_at < ROBOTS_CACHE_TTL_MS) return cached;
  const robotsUrl = baseUrl.replace(/\/$/, '') + '/robots.txt';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const allowed = new Set<string>();
    const disallow = new Set<string>();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Allow:') || trimmed.startsWith('Allow: /')) {
        const path = trimmed.replace(/^(Allow|Disallow):\s*/i, '').trim();
        if (path) allowed.add(path);
      }
      if (trimmed.startsWith('Disallow:')) {
        const path = trimmed.replace(/^Disallow:\s*/i, '').trim();
        if (path) disallow.add(path);
      }
    }
    const result = { allowed, disallow, cached_at: Date.now() };
    robotsCache.set(baseUrl, result);
    return result;
  } catch {
    return { allowed: new Set(), disallow: new Set(), cached_at: Date.now() };
  }
}

function robotsPermitsUrl(baseUrl: string, url: string, robots: { allowed: Set<string>; disallow: Set<string> }): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Check disallow first
    for (const d of robots.disallow) {
      if (path.startsWith(d)) return false;
    }
    // Check allow
    for (const a of robots.allowed) {
      if (path.startsWith(a)) return true;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Single URL fetcher
// ---------------------------------------------------------------------------

async function fetchUrlContent(url: string, opts: {
  userAgent: string;
  timeoutMs: number;
  ignoreRobots: boolean;
}): Promise<{ content: string; title: string; published_at?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const resp = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': opts.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  });
  clearTimeout(timer);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const contentType = resp.headers.get('content-type') || '';
  const text = await resp.text();
  let title = '';
  let publishedAt: string | undefined;
  // Try to extract <title> and <meta> published date
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();
  const metaDateMatch = text.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i) ||
    text.match(/<meta[^>]*name=["']publishdate["'][^>]*content=["']([^"']+)["']/i);
  if (metaDateMatch) publishedAt = metaDateMatch[1];
  // Fallback: look for og:title
  if (!title) {
    const ogTitle = text.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle) title = ogTitle[1].trim();
  }
  // Truncate very large pages
  const MAX_CONTENT = 500_000;
  const content = text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) + '\n...[truncated]' : text;
  return { content, title, published_at: publishedAt };
}

// ---------------------------------------------------------------------------
// Main fetchTopicTrack
// ---------------------------------------------------------------------------

export async function fetchTopicTrack(
  topicTrackId: string,
  opts: FetcherOptions = {},
): Promise<FetchSummary> {
  const start = Date.now();
  const storePath = opts.storePath || '~/.gbrain/ops-store.jsonl';
  const state = readOpsState(storePath);
  const track = state.topic_tracks.find(t =>
    t.id === topicTrackId || t.slug === topicTrackId || t.recipe_slug === topicTrackId
  );
  if (!track) throw new Error(`topic track not found: ${topicTrackId}`);
  if (track.status !== 'active') throw new Error(`topic track is not active: ${track.id} (${track.status})`);

  const fetcherOptions: FetcherOptions = {
    storePath,
    now: opts.now,
    maxFetches: opts.maxFetches ?? Number(track.budgets?.max_external_fetches ?? 10),
    urlList: opts.urlList,
    ignoreRobots: opts.ignoreRobots ?? false,
    userAgent: opts.userAgent ?? 'GBrain-Scout/1.0 (+https://gbrain.ai/bot)',
    timeoutMs: opts.timeoutMs ?? 15_000,
  };

  // Collect URLs to fetch
  const urlsToFetch: Array<{ url: string; source: 'url_list' | 'source_target' | 'queue' }> = [];

  if (opts.urlList && opts.urlList.length > 0) {
    // Explicit URL list override
    for (const url of opts.urlList) {
      try { new URL(url); urlsToFetch.push({ url, source: 'url_list' }); }
      catch { /* skip invalid URLs */ }
    }
  } else {
    // Collect from source_targets
    for (const target of track.source_targets) {
      const decision = decideSourceTargetFetch(target, {});
      if (!decision.allowed) continue;
      if (target.url) urlsToFetch.push({ url: target.url, source: 'source_target' });
    }
    // Also collect from queued scout_source_queue items
    const queued = state.scout_source_queue.filter(q =>
      q.topic_track_id === track.id && q.status === 'queued'
    );
    for (const item of queued) {
      if (item.source_url) urlsToFetch.push({ url: item.source_url, source: 'queue' });
    }
  }

  const maxFetches = fetcherOptions.maxFetches ?? 10;
  const toFetch = urlsToFetch.slice(0, maxFetches);
  const skipped = urlsToFetch.slice(maxFetches);

  const results: FetchResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let robotsBlocked = 0;
  let rateLimited = 0;

  for (const { url, source } of toFetch) {
    const domain = domainOfUrl(url);
    const result: FetchResult = { url, ok: false };

    // Rate limit check
    if (rateLimitDomain(domain)) {
      result.rate_limited = true;
      result.error = `rate limit: domain ${domain} fetched too recently`;
      rateLimited++;
      results.push(result);
      continue;
    }

    // robots.txt check (unless ignored)
    if (!fetcherOptions.ignoreRobots) {
      try {
        const baseUrl = new URL(url).origin;
        const robots = await fetchRobotsTxt(baseUrl, fetcherOptions.userAgent!, fetcherOptions.timeoutMs!);
        if (!robotsPermitsUrl(baseUrl, url, robots)) {
          result.robots_blocked = true;
          result.error = 'robots.txt disallows this path';
          robotsBlocked++;
          results.push(result);
          continue;
        }
      } catch {
        // robots fetch failed — proceed optimistically (common for smaller sites)
      }
    }

    // Do the fetch
    const fetchStart = Date.now();
    try {
      const { content, title, published_at } = await fetchUrlContent(url, {
        userAgent: fetcherOptions.userAgent!,
        timeoutMs: fetcherOptions.timeoutMs!,
        ignoreRobots: fetcherOptions.ignoreRobots!,
      });
      result.ok = true;
      result.content = content;
      result.title = title;
      result.published_at = published_at;
      result.content_hash = createHash('sha256').update(content).digest('hex');
      result.fetch_duration_ms = Date.now() - fetchStart;
      succeeded++;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.fetch_duration_ms = Date.now() - fetchStart;
      failed++;
    }

    results.push(result);

    // Write to scout_source_queue with status=fetched (or failed)
    const queueStatus = result.ok ? 'fetched' : 'failed';
    upsertScoutSourceQueueItem({
      id: `fetched_${createHash('sha256').update(url + Date.now()).digest('hex').slice(0, 16)}`,
      topic_track_id: track.id,
      query: source,
      status: queueStatus,
      source_class: source,
      source_url: url,
      source_title: result.title,
      published_at: result.published_at,
      privacy_tier: 'P3_PUBLIC',
      namespace: 'world',
      metadata: {
        source,
        fetch_duration_ms: result.fetch_duration_ms,
        content_hash: result.content_hash,
        error: result.error,
        robots_blocked: result.robots_blocked,
        rate_limited: result.rate_limited,
        from_url_list: !!opts.urlList,
      },
    }, { path: storePath, now: opts.now });
  }

  // Mark skipped items
  for (const { url } of skipped) {
    upsertScoutSourceQueueItem({
      id: `skipped_${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
      topic_track_id: track.id,
      query: 'budget_exceeded',
      status: 'skipped',
      source_url: url,
      privacy_tier: 'P3_PUBLIC',
      namespace: 'world',
      metadata: { reason: 'max_fetches_per_run_exceeded' },
    }, { path: storePath, now: opts.now });
  }

  return {
    topic_track_id: track.id,
    topic: track.slug,
    run_id: `fetch_${Date.now().toString(36)}`,
    mode: 'live_fetch',
    fetches: { total: toFetch.length, succeeded, failed, skipped: skipped.length, robots_blocked: robotsBlocked, rate_limited: rateLimited },
    results,
    queued_items: toFetch.length,
    warnings: [
      ...(robotsBlocked > 0 ? [`${robotsBlocked} URL(s) blocked by robots.txt`] : []),
      ...(rateLimited > 0 ? [`${rateLimited} URL(s) rate-limited (domain interval enforced)`] : []),
      ...(skipped.length > 0 ? [`${skipped.length} URL(s) skipped due to fetch budget`] : []),
      'Fetch results written to scout_source_queue (status=fetched/failed/skipped)',
    ],
    duration_ms: Date.now() - start,
  };
}