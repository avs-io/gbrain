import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  classifyBookmarkItem,
  parseBookmarkMarkdown,
  type RawBookmarkItem,
} from './bookmarks-agent-core.ts';

export type SignalType = 'critical' | 'notable' | 'background';

export interface Signal {
  type: SignalType;
  source: 'bookmarks';
  content: string;
  relevance: string;
  timestamp: string;
  dedupeKey?: string;
}

export interface SignalState {
  seenDedupeKeys: string[];
}

export interface RunBookmarksAgentOptions {
  bookmarkDir: string;
  signalsDir: string;
  archiveDir: string;
  statePath: string;
}

const EMPTY_STATE: SignalState = { seenDedupeKeys: [] };

export function extractSignals(text: string, timestamp = new Date().toISOString()): Signal[] {
  const lower = text.toLowerCase();
  const signals: Signal[] = [];

  if (hasAny(lower, ['sovereign ai', 'data sovereignty', 'on-premise', 'india ai mission', 'indiaai', 'bharatgen', 'sarvam'])) {
    signals.push({
      type: 'critical',
      source: 'bookmarks',
      content: text,
      relevance: 'Sovereign AI / data infrastructure',
      timestamp,
    });
  }

  if (hasAny(lower, ['judicial', 'supreme court', 'e-courts', 'ecourts'])) {
    signals.push({
      type: 'critical',
      source: 'bookmarks',
      content: text,
      relevance: 'judicial-ai / actionable',
      timestamp,
    });
  }

  if (hasAny(lower, ['gbrain', 'lightrag', 'n8n', 'mcp', 'openclaw', 'qwen', 'mlx', 'local ai', 'llama', 'gpt', 'benchmark', 'latency'])) {
    signals.push({
      type: 'notable',
      source: 'bookmarks',
      content: text,
      relevance: 'local-llm / watch',
      timestamp,
    });
  }

  return dedupeSignals(signals);
}

export function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();

  return signals.filter(signal => {
    const key = signal.dedupeKey ?? [signal.type, signal.source, signal.content, signal.relevance].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function partitionSignalsBySeen(signals: Signal[], seenDedupeKeys: string[]): { fresh: Signal[]; seen: Signal[] } {
  const seenKeys = new Set(seenDedupeKeys);
  const fresh: Signal[] = [];
  const seen: Signal[] = [];

  for (const signal of signals) {
    if (signal.dedupeKey && seenKeys.has(signal.dedupeKey)) seen.push(signal);
    else fresh.push(signal);
  }

  return { fresh, seen };
}

export function loadSignalState(statePath: string): SignalState {
  if (!existsSync(statePath)) return { ...EMPTY_STATE };

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<SignalState>;
    return {
      seenDedupeKeys: Array.isArray(parsed.seenDedupeKeys)
        ? parsed.seenDedupeKeys.filter((key): key is string => typeof key === 'string')
        : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function runBookmarksAgent(options: RunBookmarksAgentOptions): Promise<Signal[]> {
  const state = loadSignalState(options.statePath);
  const items = readBookmarkItems(options.bookmarkDir);
  const signals = dedupeSignals(items.map(itemToSignal));
  const { fresh } = partitionSignalsBySeen(signals, state.seenDedupeKeys);

  if (fresh.length > 0) {
    writeSignalLog(options.signalsDir, fresh);
    writeSignalState(options.statePath, {
      seenDedupeKeys: Array.from(new Set([...state.seenDedupeKeys, ...fresh.map(signal => signal.dedupeKey).filter((key): key is string => Boolean(key))])),
    });
  }

  mkdirSync(options.archiveDir, { recursive: true });
  return fresh;
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term));
}

function readBookmarkItems(bookmarkDir: string): RawBookmarkItem[] {
  if (!existsSync(bookmarkDir)) return [];

  return readdirSync(bookmarkDir)
    .filter(file => file.endsWith('.md'))
    .flatMap(file => parseBookmarkMarkdown(readFileSync(join(bookmarkDir, file), 'utf-8')));
}

function itemToSignal(item: RawBookmarkItem): Signal {
  const classified = classifyBookmarkItem(item);
  return {
    type: classified.type,
    source: 'bookmarks',
    content: item.content,
    relevance: `${classified.domain} / ${classified.intent}`,
    timestamp: item.capturedAt || new Date().toISOString(),
    dedupeKey: classified.dedupeKey,
  };
}

function writeSignalLog(signalsDir: string, signals: Signal[]): void {
  mkdirSync(signalsDir, { recursive: true });
  const path = join(signalsDir, `signals-${new Date().toISOString().slice(0, 10)}.md`);
  const body = signals
    .map(signal => `- [${signal.type.toUpperCase()}] ${signal.relevance}: ${signal.content}`)
    .join('\n');
  writeFileSync(path, `${body}\n`, { flag: 'a' });
}

function writeSignalState(statePath: string, state: SignalState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}
