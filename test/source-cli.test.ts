import { describe, expect, test } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import { runSourceCommand } from '../src/commands/source.ts';

const page = {
  slug: 'sources/chatgpt/full-export-all/2025-11-06-world8-north-star',
  source_id: 'default',
  title: 'World8 North Star',
  compiled_truth: `### USER
What is my North Star?

### ASSISTANT
Verdict: build with exact evidence.
World 8 needs source windows.`,
  timeline: '2025-11-06 — World8 discussion',
};

function fakeEngine(rows: any[]): BrainEngine {
  return {
    kind: 'pglite',
    executeRaw: async () => rows,
  } as unknown as BrainEngine;
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

describe('source CLI command', () => {
  test('help prints without a DB connection', async () => {
    const stdout = await captureStdout(() => runSourceCommand(null, ['--help']));
    expect(stdout).toContain('gbrain source show');
    expect(stdout).toContain('line_basis=stored_section');
  });

  test('show emits exact JSON window with deterministic span id', async () => {
    const stdout = await captureStdout(() => runSourceCommand(fakeEngine([page]), [
      'show',
      page.slug,
      '--lines',
      '2:5',
      '--json',
    ]));
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe('hit');
    expect(payload.page.line_basis).toBe('stored_section');
    expect(payload.window.span_id).toBe(`gbs1:default:${page.slug}#compiled_truth:L2-L5`);
    expect(payload.window.quote).toContain('North Star');
    expect(payload.window.quote).toContain('Verdict:');
  });

  test('grep emits source windows containing phrase and near phrase', async () => {
    const stdout = await captureStdout(() => runSourceCommand(fakeEngine([page]), [
      'grep',
      page.slug,
      'North Star',
      '--near',
      'Verdict',
      '--json',
    ]));
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe('hit');
    expect(payload.windows[0].span_id).toMatch(/^gbs1:default:/);
    expect(payload.windows[0].quote).toContain('North Star');
    expect(payload.windows[0].quote).toContain('Verdict:');
  });

  test('ambiguous slug errors with source-id candidates', async () => {
    await expect(runSourceCommand(fakeEngine([
      { ...page, source_id: 'default' },
      { ...page, source_id: 'other' },
    ]), ['show', page.slug])).rejects.toThrow('Ambiguous source slug');
  });
});
