import { describe, expect, test } from 'bun:test';
import {
  aroundSpan,
  buildSourceDocument,
  grepDocument,
  locateChunkWindow,
  makeSpanId,
  parseSpanId,
  showLines,
} from '../src/core/evidence/source-window.ts';

const compiledTruth = `### USER — 2025-11-06T10:00:00Z
I don't want rails. I don't want receipts. I don't want compliance.
What is my North Star if you remove all this?

### ASSISTANT — 2025-11-06T10:01:00Z
Verdict: build the system that turns reality and values into the best possible decision.
That means World 8 needs exact evidence, not vibes.

### USER — 2025-11-06T10:02:00Z
Keep the source attached.`;

function fixtureDoc() {
  return buildSourceDocument({
    source_id: 'default',
    slug: 'sources/chatgpt/full-export-all/2025-11-06-world8-north-star',
    title: 'World8 North Star',
    compiled_truth: compiledTruth.replace(/\n/g, '\r\n'),
    timeline: '2025-11-06 — World8 discussion',
  });
}

describe('source-window primitives', () => {
  test('showLines returns exact requested lines and deterministic span id', () => {
    const doc = fixtureDoc();
    const shown = showLines(doc, 'compiled_truth', 2, 3);

    expect(shown.quote).toBe("I don't want rails. I don't want receipts. I don't want compliance.\nWhat is my North Star if you remove all this?");
    expect(shown.spanId).toBe(
      'gbs1:default:sources/chatgpt/full-export-all/2025-11-06-world8-north-star#compiled_truth:L2-L3',
    );
    expect(shown.quoteHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('makeSpanId and parseSpanId round-trip safe source locations', () => {
    const span = {
      sourceId: 'default',
      slug: 'sources/chatgpt/full-export-all/2025-11-06-world8-north-star',
      section: 'compiled_truth',
      startLine: 5,
      endLine: 6,
    };

    expect(parseSpanId(makeSpanId(span))).toEqual(span);
    expect(() => parseSpanId('gbs1:default:../secret#compiled_truth:L1-L2')).toThrow();
    expect(() => parseSpanId('gbs1:default:/absolute/path#compiled_truth:L1-L2')).toThrow();
    expect(() => parseSpanId('not-a-span')).toThrow();
  });

  test('aroundSpan expands context and clamps at document boundaries', () => {
    const doc = fixtureDoc();
    const spanId = makeSpanId({
      sourceId: doc.sourceId,
      slug: doc.slug,
      section: 'compiled_truth',
      startLine: 1,
      endLine: 1,
    });

    const around = aroundSpan(doc, spanId, 5, 1);
    expect(around.startLine).toBe(1);
    expect(around.endLine).toBe(2);
    expect(around.quote).toBe("### USER — 2025-11-06T10:00:00Z\nI don't want rails. I don't want receipts. I don't want compliance.");
  });

  test('grepDocument ranks the smallest line window containing phrase and near phrase', () => {
    const doc = fixtureDoc();
    const hits = grepDocument(doc, 'North Star', { near: 'Verdict' });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].section).toBe('compiled_truth');
    expect(hits[0].startLine).toBe(3);
    expect(hits[0].endLine).toBe(6);
    expect(hits[0].quote).toContain('North Star');
    expect(hits[0].quote).toContain('Verdict:');
  });

  test('locateChunkWindow maps exact and normalized-whitespace excerpts to line ranges', () => {
    const doc = fixtureDoc();

    const exact = locateChunkWindow(doc, 'Verdict: build the system that turns reality and values into the best possible decision.\nThat means World 8 needs exact evidence, not vibes.');
    expect(exact?.startLine).toBe(6);
    expect(exact?.endLine).toBe(7);
    expect(exact?.matchedBy).toBe('exact');

    const normalized = locateChunkWindow(doc, 'Verdict: build the system that turns reality and values into the best possible decision.   That means World 8 needs exact evidence, not vibes.');
    expect(normalized?.startLine).toBe(6);
    expect(normalized?.endLine).toBe(7);
    expect(normalized?.matchedBy).toBe('normalized');
  });

  test('locateChunkWindow abstains on low-confidence text', () => {
    const doc = fixtureDoc();
    const missing = locateChunkWindow(doc, 'This phrase belongs to a totally different source with unrelated substance.');
    expect(missing).toBeNull();
  });
});
