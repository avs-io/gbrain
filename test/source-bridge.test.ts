import { describe, expect, test } from 'bun:test';

import { runSources } from '../src/commands/sources.ts';
import {
  pageSourceItemFromPage,
  parseSourceSpanRef,
  resolveSourceSpan,
  sourceItemIdForPage,
  sourceSpanForWebText,
  sourceSpanFromGbs1,
  validateSourceSpanRecord,
  webSourceItem,
} from '../src/core/evidence/source-bridge.ts';

const gbs1 = 'gbs1:default:sources/test/source-bridge#compiled_truth:L2-L3';
const page = {
  slug: 'sources/test/source-bridge',
  source_id: 'default',
  title: 'Source bridge fixture',
  compiled_truth: 'Header\nBridge quote begins.\nBridge quote ends.\nFooter',
  timeline: '',
};

function fakeEngine() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async executeRaw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      calls.push({ sql, params });
      if (params?.[0] === page.slug && params?.[1] === 'default') return [page as T];
      return [];
    },
  };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('source_items/source_spans bridge', () => {
  test('existing gbs1 refs remain valid source_span refs', async () => {
    const parsed = parseSourceSpanRef(gbs1);
    expect(parsed.ref_kind).toBe('gbs1');

    const span = sourceSpanFromGbs1(gbs1);
    expect(span.ref).toBe(gbs1);
    expect(span.source_item_id).toBe(sourceItemIdForPage('default', page.slug));
    expect(span.section).toBe('compiled_truth');
    expect(span.start_line).toBe(2);
    expect(validateSourceSpanRecord(span)).toBe(span);
  });

  test('resolves gbs1 bridge records without changing existing recall semantics', async () => {
    const engine = fakeEngine();
    const resolved = await resolveSourceSpan(engine as any, gbs1);
    expect(resolved.item).toEqual(pageSourceItemFromPage(page));
    expect(resolved.span.ref_kind).toBe('gbs1');
    expect(resolved.span.ref).toBe(gbs1);
    expect(resolved.span.quote).toBe('Bridge quote begins.\nBridge quote ends.');
    expect(resolved.window?.spanId).toBe(gbs1);
    expect(engine.calls).toHaveLength(1);
  });

  test('synthetic public web spans can be represented without trusted-memory mutation', () => {
    const engine = fakeEngine();
    const item = webSourceItem({
      url: 'https://example.com/public-report',
      title: 'Public report',
      content: 'A public source says the world changed.',
    });
    const span = sourceSpanForWebText(item, {
      startChar: 0,
      endChar: 37,
      quote: 'A public source says the world changed.',
      selector: 'p:nth-of-type(1)',
    });

    expect(item.namespace).toBe('world');
    expect(item.privacy).toBe('P3_PUBLIC');
    expect(span.ref).toStartWith('srcspan1:web:');
    expect(span.source_item_id).toBe(item.id);
    expect(validateSourceSpanRecord(span)).toBe(span);
    expect(engine.calls).toHaveLength(0);
  });

  test('sources span show and item show expose JSON bridge records', async () => {
    const engine = fakeEngine();
    const spanOut = JSON.parse(await captureStdout(() => runSources(engine as any, ['span', 'show', gbs1, '--json'])));
    expect(spanOut.status).toBe('hit');
    expect(spanOut.span.ref).toBe(gbs1);
    expect(spanOut.item.id).toBe(sourceItemIdForPage('default', page.slug));

    const itemOut = JSON.parse(await captureStdout(() => runSources(engine as any, ['item', 'show', sourceItemIdForPage('default', page.slug), '--json'])));
    expect(itemOut.status).toBe('hit');
    expect(itemOut.item.kind).toBe('gbrain_page');
    expect(itemOut.item.slug).toBe(page.slug);
  });
});
