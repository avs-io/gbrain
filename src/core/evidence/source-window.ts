import { createHash } from 'node:crypto';

export const SOURCE_SPAN_PREFIX = 'gbs1:';

export interface PageLike {
  source_id?: string | null;
  sourceId?: string | null;
  slug: string;
  title?: string | null;
  compiled_truth?: string | null;
  compiledTruth?: string | null;
  timeline?: string | null;
}

export interface SourceSection {
  name: string;
  text: string;
  lines: string[];
}

export interface SourceDocument {
  sourceId: string;
  slug: string;
  title?: string;
  sections: Record<string, SourceSection>;
}

export interface SpanLocation {
  sourceId: string;
  slug: string;
  section: string;
  startLine: number;
  endLine: number;
}

export interface SourceWindow extends SpanLocation {
  spanId: string;
  quote: string;
  quoteHash: string;
  lineBasis: 'stored_section';
  score?: number;
  matchedBy?: 'exact' | 'normalized' | 'overlap' | 'grep';
}

export interface GrepOptions {
  section?: string;
  near?: string;
  before?: number;
  after?: number;
  limit?: number;
}

export interface LocateOptions {
  section?: string;
  minConfidence?: number;
}

interface CharLineIndex {
  starts: number[];
  endsExclusive: number[];
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function splitLines(text: string): string[] {
  return normalizeNewlines(text).split('\n');
}

function sectionFrom(name: string, text: string | null | undefined): SourceSection | null {
  if (text == null) return null;
  const normalized = normalizeNewlines(String(text));
  return { name, text: normalized, lines: splitLines(normalized) };
}

export function buildSourceDocument(page: PageLike): SourceDocument {
  const sourceId = page.source_id ?? page.sourceId ?? 'default';
  const sections: Record<string, SourceSection> = {};
  for (const section of [
    sectionFrom('compiled_truth', page.compiled_truth ?? page.compiledTruth),
    sectionFrom('timeline', page.timeline),
  ]) {
    if (section) sections[section.name] = section;
  }

  return {
    sourceId,
    slug: page.slug,
    title: page.title ?? undefined,
    sections,
  };
}

function assertSafeSlug(slug: string): void {
  if (!slug || slug.startsWith('/') || slug.includes('\\')) {
    throw new Error(`Invalid source span slug: ${slug}`);
  }
  const segments = slug.split('/');
  if (segments.some((part) => part === '..' || part === '.')) {
    throw new Error(`Invalid source span slug: ${slug}`);
  }
}

function assertSpanParts(span: SpanLocation): void {
  if (!span.sourceId || span.sourceId.includes(':') || span.sourceId.includes('#')) {
    throw new Error(`Invalid source span sourceId: ${span.sourceId}`);
  }
  assertSafeSlug(span.slug);
  if (!span.section || span.section.includes('#') || /\s/.test(span.section)) {
    throw new Error(`Invalid source span section: ${span.section}`);
  }
  if (!Number.isInteger(span.startLine) || !Number.isInteger(span.endLine) || span.startLine < 1 || span.endLine < span.startLine) {
    throw new Error(`Invalid source span line range: L${span.startLine}-L${span.endLine}`);
  }
}

export function makeSpanId(span: SpanLocation): string {
  assertSpanParts(span);
  return `${SOURCE_SPAN_PREFIX}${span.sourceId}:${span.slug}#${span.section}:L${span.startLine}-L${span.endLine}`;
}

export function parseSpanId(spanId: string): SpanLocation {
  const match = /^gbs1:([^:#]+):(.+)#([^#]+):L([1-9]\d*)-L([1-9]\d*)$/.exec(spanId);
  if (!match) throw new Error(`Malformed source span id: ${spanId}`);
  const [, sourceId, slug, section, start, end] = match;
  const parsed = {
    sourceId,
    slug,
    section,
    startLine: Number(start),
    endLine: Number(end),
  };
  assertSpanParts(parsed);
  return parsed;
}

function getSection(doc: SourceDocument, sectionName: string): SourceSection {
  const section = doc.sections[sectionName];
  if (!section) throw new Error(`Unknown source section: ${sectionName}`);
  return section;
}

function clampLine(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function quoteHash(quote: string): string {
  return createHash('sha256').update(quote).digest('hex');
}

function makeWindow(doc: SourceDocument, sectionName: string, startLine: number, endLine: number, extra: Partial<SourceWindow> = {}): SourceWindow {
  const section = getSection(doc, sectionName);
  const maxLine = Math.max(1, section.lines.length);
  const start = clampLine(startLine, 1, maxLine);
  const end = clampLine(endLine, start, maxLine);
  const quote = section.lines.slice(start - 1, end).join('\n');
  return {
    sourceId: doc.sourceId,
    slug: doc.slug,
    section: sectionName,
    startLine: start,
    endLine: end,
    spanId: makeSpanId({ sourceId: doc.sourceId, slug: doc.slug, section: sectionName, startLine: start, endLine: end }),
    quote,
    quoteHash: quoteHash(quote),
    lineBasis: 'stored_section',
    ...extra,
  };
}

export function showLines(doc: SourceDocument, sectionName: string, startLine: number, endLine: number): SourceWindow {
  return makeWindow(doc, sectionName, startLine, endLine, { matchedBy: 'exact' });
}

export function aroundSpan(doc: SourceDocument, span: string | SpanLocation, before = 5, after = 5): SourceWindow {
  const parsed = typeof span === 'string' ? parseSpanId(span) : span;
  if (parsed.sourceId !== doc.sourceId || parsed.slug !== doc.slug) {
    throw new Error(`Span does not belong to document: ${typeof span === 'string' ? span : makeSpanId(parsed)}`);
  }
  return makeWindow(doc, parsed.section, parsed.startLine - Math.max(0, before), parsed.endLine + Math.max(0, after), { matchedBy: 'exact' });
}

function buildLineIndex(section: SourceSection): CharLineIndex {
  const starts: number[] = [];
  const endsExclusive: number[] = [];
  let offset = 0;
  for (const line of section.lines) {
    starts.push(offset);
    offset += line.length;
    endsExclusive.push(offset);
    offset += 1; // newline separator, including virtual separator after final line for simple indexing
  }
  return { starts, endsExclusive };
}

function lineForChar(index: CharLineIndex, charOffset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (index.starts[mid] <= charOffset && charOffset <= index.endsExclusive[mid]) return mid + 1;
    if (index.starts[mid] > charOffset) hi = mid - 1;
    else lo = mid + 1;
  }
  return clampLine(lo + 1, 1, index.starts.length);
}

function charRangeToLines(section: SourceSection, startChar: number, endExclusive: number): { startLine: number; endLine: number } {
  const index = buildLineIndex(section);
  return {
    startLine: lineForChar(index, startChar),
    endLine: lineForChar(index, Math.max(startChar, endExclusive - 1)),
  };
}

function findLiteralRanges(text: string, phrase: string): Array<{ start: number; end: number }> {
  const needle = normalizeNewlines(phrase).toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (true) {
    const found = haystack.indexOf(needle, offset);
    if (found === -1) break;
    ranges.push({ start: found, end: found + needle.length });
    offset = found + Math.max(1, needle.length);
  }
  return ranges;
}

function distanceBetween(a: { start: number; end: number }, b: { start: number; end: number }): number {
  if (a.end < b.start) return b.start - a.end;
  if (b.end < a.start) return a.start - b.end;
  return 0;
}

export function grepDocument(doc: SourceDocument, phrase: string, opts: GrepOptions = {}): SourceWindow[] {
  const sectionNames = opts.section ? [opts.section] : Object.keys(doc.sections);
  const before = Math.max(0, opts.before ?? 0);
  const after = Math.max(0, opts.after ?? 0);
  const limit = Math.max(1, opts.limit ?? 20);
  const results: SourceWindow[] = [];

  for (const sectionName of sectionNames) {
    const section = getSection(doc, sectionName);
    const phraseRanges = findLiteralRanges(section.text, phrase);
    const nearRanges = opts.near ? findLiteralRanges(section.text, opts.near) : [];

    for (const range of phraseRanges) {
      let combined = range;
      let distance = 0;
      if (opts.near) {
        if (nearRanges.length === 0) continue;
        const nearest = nearRanges
          .map((near) => ({ near, distance: distanceBetween(range, near) }))
          .sort((a, b) => a.distance - b.distance)[0];
        combined = { start: Math.min(range.start, nearest.near.start), end: Math.max(range.end, nearest.near.end) };
        distance = nearest.distance;
      }
      const lineRange = charRangeToLines(section, combined.start, combined.end);
      results.push(makeWindow(doc, sectionName, lineRange.startLine - before, lineRange.endLine + after, {
        matchedBy: 'grep',
        score: opts.near ? 1 / (1 + distance) : 1,
      }));
    }
  }

  return results
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.startLine - b.startLine)
    .slice(0, limit);
}

interface NormalizedText {
  text: string;
  originalOffsets: number[];
}

function normalizeWhitespaceWithMap(text: string): NormalizedText {
  const originalOffsets: number[] = [];
  let out = '';
  let pendingSpaceOffset: number | null = null;
  let previousWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!previousWasSpace && pendingSpaceOffset == null) pendingSpaceOffset = i;
      previousWasSpace = true;
      continue;
    }
    if (pendingSpaceOffset != null && out.length > 0) {
      out += ' ';
      originalOffsets.push(pendingSpaceOffset);
    }
    pendingSpaceOffset = null;
    out += ch;
    originalOffsets.push(i);
    previousWasSpace = false;
  }

  return { text: out.trim(), originalOffsets };
}

function tokens(text: string): string[] {
  return normalizeNewlines(text)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_'-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function locateInSection(doc: SourceDocument, sectionName: string, chunkText: string, minConfidence: number): SourceWindow | null {
  const section = getSection(doc, sectionName);
  const normalizedChunk = normalizeNewlines(chunkText).trim();
  if (!normalizedChunk) return null;

  const exact = section.text.indexOf(normalizedChunk);
  if (exact !== -1) {
    const range = charRangeToLines(section, exact, exact + normalizedChunk.length);
    return makeWindow(doc, sectionName, range.startLine, range.endLine, { matchedBy: 'exact', score: 1 });
  }

  const normalizedSection = normalizeWhitespaceWithMap(section.text);
  const normalizedNeedle = normalizeWhitespaceWithMap(normalizedChunk).text;
  const normalizedFound = normalizedSection.text.indexOf(normalizedNeedle);
  if (normalizedFound !== -1 && normalizedNeedle.length > 0) {
    const start = normalizedSection.originalOffsets[normalizedFound] ?? 0;
    const endNormIndex = normalizedFound + normalizedNeedle.length - 1;
    const end = (normalizedSection.originalOffsets[endNormIndex] ?? start) + 1;
    const range = charRangeToLines(section, start, end);
    return makeWindow(doc, sectionName, range.startLine, range.endLine, { matchedBy: 'normalized', score: 0.95 });
  }

  const chunkTokens = tokens(normalizedChunk);
  if (chunkTokens.length === 0) return null;
  const chunkSet = new Set(chunkTokens);
  const targetWindow = Math.max(1, normalizedChunk.split('\n').length);
  let best: { startLine: number; endLine: number; confidence: number } | null = null;

  for (let start = 0; start < section.lines.length; start++) {
    const end = Math.min(section.lines.length, start + Math.max(targetWindow + 2, 3));
    const windowTokens = tokens(section.lines.slice(start, end).join('\n'));
    if (windowTokens.length === 0) continue;
    let hits = 0;
    for (const token of chunkSet) if (windowTokens.includes(token)) hits += 1;
    const confidence = hits / chunkSet.size;
    if (!best || confidence > best.confidence) best = { startLine: start + 1, endLine: end, confidence };
  }

  if (best && best.confidence >= minConfidence && (chunkSet.size <= 3 || best.confidence >= 0.75)) {
    return makeWindow(doc, sectionName, best.startLine, best.endLine, { matchedBy: 'overlap', score: best.confidence });
  }

  return null;
}

export function locateChunkWindow(doc: SourceDocument, chunkText: string, opts: LocateOptions = {}): SourceWindow | null {
  const minConfidence = opts.minConfidence ?? 0.6;
  const sectionNames = opts.section ? [opts.section] : Object.keys(doc.sections);
  const matches = sectionNames
    .map((sectionName) => locateInSection(doc, sectionName, chunkText, minConfidence))
    .filter((match): match is SourceWindow => Boolean(match))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return matches[0] ?? null;
}
