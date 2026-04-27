export interface RawBookmarkItem {
  url: string;
  title: string;
  content: string;
  hash: string;
  platform: string;
  capturedAt: string;
}

export type BookmarkSignalType = 'critical' | 'notable' | 'background';
export type BookmarkSignalDomain = 'sovereign-ai' | 'judicial-ai' | 'gbrain' | 'local-llm' | 'personal' | 'other';
export type BookmarkSignalIntent = 'actionable' | 'watch' | 'archive' | 'ignore';
export type BookmarkSignalConfidence = 'high' | 'medium' | 'low';

export interface StructuredBookmarkSignal {
  type: BookmarkSignalType;
  domain: BookmarkSignalDomain;
  intent: BookmarkSignalIntent;
  confidence: BookmarkSignalConfidence;
  whyItMatters: string;
  nextStep: string;
  dedupeKey: string;
  source: 'bookmarks';
  url: string;
  title: string;
  content: string;
  hash: string;
  platform: string;
  capturedAt: string;
}

interface EmbeddedBookmarkRecord {
  schema?: unknown;
  url?: unknown;
  title?: unknown;
  content?: unknown;
  hash?: unknown;
  platform?: unknown;
  captured_at?: unknown;
  ts?: unknown;
}

export function extractMarkdownBody(markdown: string): string {
  const headingMatch = markdown.match(/^## Body\s*$/m);
  if (!headingMatch || headingMatch.index === undefined) return '';

  const afterHeading = markdown.slice(headingMatch.index + headingMatch[0].length);
  const trimmedStart = afterHeading.replace(/^\s+/, '');
  const endMatch = trimmedStart.match(/\n(?:---|##\s+)/);
  return (endMatch ? trimmedStart.slice(0, endMatch.index) : trimmedStart).trim();
}

export function extractEmbeddedJsonObjects(input: string): unknown[] {
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = input.slice(start, i + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // ignore malformed object candidates
        }
        start = -1;
      }
    }
  }

  return objects;
}

export function normalizeBookmarkRecord(record: unknown): RawBookmarkItem | null {
  if (!record || typeof record !== 'object') return null;

  const candidate = record as EmbeddedBookmarkRecord;
  if (candidate.schema !== 'browser_transcript_message_v1') return null;
  if (typeof candidate.url !== 'string' || typeof candidate.title !== 'string') return null;
  if (typeof candidate.content !== 'string' || typeof candidate.hash !== 'string') return null;
  if (typeof candidate.platform !== 'string') return null;

  const capturedAt = typeof candidate.captured_at === 'string'
    ? candidate.captured_at
    : typeof candidate.ts === 'string'
      ? candidate.ts
      : '';

  return {
    url: candidate.url,
    title: candidate.title,
    content: candidate.content,
    hash: candidate.hash,
    platform: candidate.platform,
    capturedAt,
  };
}

export function parseBookmarkMarkdown(markdown: string): RawBookmarkItem[] {
  return extractEmbeddedJsonObjects(extractMarkdownBody(markdown))
    .map(normalizeBookmarkRecord)
    .filter((item): item is RawBookmarkItem => item !== null);
}

function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term));
}

export function makeBookmarkDedupeKey(item: RawBookmarkItem): string {
  return item.hash || [
    normalizeKeyPart(item.platform),
    normalizeKeyPart(item.url),
    normalizeKeyPart(item.title),
    normalizeKeyPart(item.content).slice(0, 240),
  ].join('::');
}

export function classifyBookmarkItem(item: RawBookmarkItem): StructuredBookmarkSignal {
  const lower = item.content.toLowerCase();
  const dedupeBase = makeBookmarkDedupeKey(item);

  if (hasAny(lower, ['sovereign ai', 'data sovereignty', 'on-premise', 'india ai mission', 'indiaai', 'bharatgen', 'sarvam'])) {
    return {
      type: 'critical',
      domain: 'sovereign-ai',
      intent: 'actionable',
      confidence: hasAny(lower, ['sovereign ai', 'data sovereignty', 'on-premise']) ? 'high' : 'medium',
      whyItMatters: 'Directly relevant to sovereign AI positioning, infrastructure, or India AI execution.',
      nextStep: 'Review quickly and decide whether to capture as an active sovereign AI signal.',
      dedupeKey: `sovereign-ai::actionable::${dedupeBase}`,
      source: 'bookmarks',
      ...item,
    };
  }

  if (hasAny(lower, ['judicial', 'supreme court', 'e-courts', 'ecourts'])) {
    return {
      type: 'critical',
      domain: 'judicial-ai',
      intent: 'actionable',
      confidence: hasAny(lower, ['supreme court', 'e-courts', 'ecourts']) ? 'high' : 'medium',
      whyItMatters: 'Potentially impacts judicial AI strategy, court digitization, or institutional access.',
      nextStep: 'Check whether this should be routed into judicial AI tracking or outreach prep.',
      dedupeKey: `judicial-ai::actionable::${dedupeBase}`,
      source: 'bookmarks',
      ...item,
    };
  }

  if (hasAny(lower, ['gbrain', 'lightrag', 'n8n', 'mcp', 'openclaw'])) {
    return {
      type: 'notable',
      domain: 'gbrain',
      intent: 'watch',
      confidence: 'medium',
      whyItMatters: 'May improve the memory, orchestration, or retrieval stack.',
      nextStep: 'Add to GBrain tooling watchlist if the implementation detail looks novel.',
      dedupeKey: `gbrain::watch::${dedupeBase}`,
      source: 'bookmarks',
      ...item,
    };
  }

  if (hasAny(lower, ['qwen', 'mlx', 'local ai', 'llama', 'gpt', 'benchmark', 'latency'])) {
    return {
      type: 'notable',
      domain: 'local-llm',
      intent: 'watch',
      confidence: hasAny(lower, ['benchmark', 'latency', 'mlx', 'qwen']) ? 'high' : 'medium',
      whyItMatters: 'Useful for local model performance, routing, or worker-lane decisions.',
      nextStep: 'Check whether this changes local-model benchmarking or routing choices.',
      dedupeKey: `local-llm::watch::${dedupeBase}`,
      source: 'bookmarks',
      ...item,
    };
  }

  if (hasAny(lower, ['recipe', 'cooking', 'travel', 'fitness', 'shopping'])) {
    return {
      type: 'background',
      domain: 'personal',
      intent: 'archive',
      confidence: 'medium',
      whyItMatters: 'Personal-interest content without current mission relevance.',
      nextStep: 'Archive silently unless explicitly requested later.',
      dedupeKey: `personal::archive::${dedupeBase}`,
      source: 'bookmarks',
      ...item,
    };
  }

  return {
    type: 'background',
    domain: 'other',
    intent: 'ignore',
    confidence: 'low',
    whyItMatters: 'No clear sovereign AI, judicial AI, GBrain, local LLM, or personal signal found.',
    nextStep: 'Ignore for now.',
    dedupeKey: `other::ignore::${dedupeBase}`,
    source: 'bookmarks',
    ...item,
  };
}

export function dedupeRawBookmarks(items: RawBookmarkItem[]): RawBookmarkItem[] {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = makeBookmarkDedupeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeStructuredSignals(items: StructuredBookmarkSignal[]): StructuredBookmarkSignal[] {
  const seen = new Set<string>();

  return items.filter(item => {
    if (seen.has(item.dedupeKey)) return false;
    seen.add(item.dedupeKey);
    return true;
  });
}
