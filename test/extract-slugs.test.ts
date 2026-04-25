/**
 * Tests for `extractLinksForSlugs` and `extractTimelineForSlugs` — the
 * slug-targeted incremental extract functions (commit c21180c).
 *
 * These functions accept a `slugs: string[]` parameter and process only the
 * specified pages, skipping everything else.  They are the core of the
 * incremental extract optimization that avoids full-brain walks during the
 * 5-minute autopilot cycle.
 *
 * Uses the same PGLite engine pattern as test/extract-db.test.ts:
 *   - connect + initSchema in beforeAll
 *   - disconnect in afterAll
 *   - truncateAll in beforeEach
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import {
  extractLinksForSlugs,
  extractTimelineForSlugs,
  walkMarkdownFiles,
  extractLinksFromFile,
  extractTimelineFromContent,
} from '../src/commands/extract.ts';

let engine: PGLiteEngine;
let brainDir: string;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  brainDir = mkdtempSync(join(tmpdir(), 'gbrain-extract-slugs-'));
}, 60_000);

afterAll(async () => {
  await engine.disconnect();
  try { rmSync(brainDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

async function truncateAll() {
  try { rmSync(brainDir, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(brainDir, { recursive: true });
  for (const t of ['content_chunks', 'links', 'tags', 'raw_data', 'timeline_entries', 'page_versions', 'ingest_log', 'pages']) {
    await (engine as any).db.exec(`DELETE FROM ${t}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function writePage(slug: string, content: string) {
  // extractLinksForSlugs / extractTimelineForSlugs construct the path as
  // join(repoPath, slug + '.md'), so the file must live at that exact path.
  const fullPath = join(brainDir, slug + '.md');
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
  await engine.putPage(slug, { type: 'note', title: slug, compiled_truth: content, frontmatter: {} });
}

// ─── extractLinksForSlugs — happy path ─────────────────────────────────────

describe('extractLinksForSlugs — happy path', () => {
  beforeEach(truncateAll);

  test('extracts links only for requested slugs', async () => {
    // Create 3 pages: alice (person), bob (person), acme (company)
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('people/bob', '---\ntype: person\n---\nBob is CTO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads Acme.');

    const created = await extractLinksForSlugs(engine, brainDir, ['companies/acme']);

    expect(created).toBe(1);
    const links = await engine.getLinks('companies/acme');
    expect(links.length).toBe(1);
    expect(links[0].to_slug).toBe('people/alice');
    expect(links[0].link_type).toBe('mentions');
  });

  test('processes multiple slugs in one call', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('people/bob', '---\ntype: person\n---\nBob is CTO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads.');
    await writePage('companies/beta', '---\ntype: company\n---\n[Bob](../people/bob.md) leads.');

    const created = await extractLinksForSlugs(engine, brainDir, [
      'companies/acme', 'companies/beta',
    ]);

    expect(created).toBe(2);
    const acmeLinks = await engine.getLinks('companies/acme');
    const betaLinks = await engine.getLinks('companies/beta');
    expect(acmeLinks[0].to_slug).toBe('people/alice');
    expect(betaLinks[0].to_slug).toBe('people/bob');
  });

  test('infers link types from directory structure', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads.');

    const created = await extractLinksForSlugs(engine, brainDir, ['companies/acme']);
    expect(created).toBe(1);

    const links = await engine.getLinks('companies/acme');
    expect(links[0].link_type).toBe('mentions');
  });
});

// ─── extractLinksForSlugs — empty slugs array ──────────────────────────────

describe('extractLinksForSlugs — empty slugs array', () => {
  beforeEach(truncateAll);

  test('returns 0 without processing any files', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md).');

    const created = await extractLinksForSlugs(engine, brainDir, []);

    expect(created).toBe(0);
    const links = await engine.getLinks('companies/acme');
    expect(links.length).toBe(0);
  });

  test('does not walk files when slugs is empty', async () => {
    // If walkMarkdownFiles were called, it would find files.
    // With empty slugs, the for-loop body never executes.
    const created = await extractLinksForSlugs(engine, brainDir, []);
    expect(created).toBe(0);
  });
});

// ─── extractLinksForSlugs — missing files ──────────────────────────────────

describe('extractLinksForSlugs — missing files', () => {
  beforeEach(truncateAll);

  test('silently skips slugs with no .md file', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice.');

    const created = await extractLinksForSlugs(engine, brainDir, ['people/ghost']);

    expect(created).toBe(0);
    // No crash, no error — just 0.
  });

  test('handles completely non-existent directory', async () => {
    const created = await extractLinksForSlugs(engine, brainDir, ['nonexistent/page']);
    expect(created).toBe(0);
  });
});

// ─── extractLinksForSlugs — partial match ──────────────────────────────────

describe('extractLinksForSlugs — partial match', () => {
  beforeEach(truncateAll);

  test('processes existing slugs, skips missing ones', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads.');

    const created = await extractLinksForSlugs(engine, brainDir, [
      'companies/acme',
      'people/ghost',
      'companies/phantom',
    ]);

    expect(created).toBe(1);
    const links = await engine.getLinks('companies/acme');
    expect(links.length).toBe(1);
  });

  test('all missing slugs returns 0', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice.');

    const created = await extractLinksForSlugs(engine, brainDir, [
      'people/ghost', 'companies/phantom', 'deals/seed',
    ]);

    expect(created).toBe(0);
  });
});

// ─── extractLinksForSlugs — engine reuse ───────────────────────────────────

describe('extractLinksForSlugs — engine reuse', () => {
  beforeEach(truncateAll);

  test('same engine can be used across multiple calls', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads.');

    const c1 = await extractLinksForSlugs(engine, brainDir, ['companies/acme']);
    expect(c1).toBe(1);

    // Second call on same engine should work without re-connecting; the function reports attempted inserts; DB keeps one row.
    const c2 = await extractLinksForSlugs(engine, brainDir, ['companies/acme']);
    expect(c2).toBe(1);

    // First row remains (idempotent via DB constraint).
    const links = await engine.getLinks('companies/acme');
    expect(links.length).toBe(1);
  });

  test('engine state persists between calls', async () => {
    await writePage('people/alice', '---\ntype: person\n---\nAlice is CEO.');
    await writePage('people/bob', '---\ntype: person\n---\nBob is CTO.');
    await writePage('companies/acme', '---\ntype: company\n---\n[Alice](../people/alice.md) leads.');
    await writePage('companies/beta', '---\ntype: company\n---\n[Bob](../people/bob.md) leads.');

    await extractLinksForSlugs(engine, brainDir, ['companies/acme']);
    const links1 = await engine.getLinks('companies/acme');
    expect(links1.length).toBe(1);

    await extractLinksForSlugs(engine, brainDir, ['companies/beta']);
    const links2 = await engine.getLinks('companies/beta');
    expect(links2.length).toBe(1);

    // Both should exist in the same engine.
    expect(await engine.getLinks('companies/acme')).toHaveLength(1);
    expect(await engine.getLinks('companies/beta')).toHaveLength(1);
  });
});

// ─── extractTimelineForSlugs — happy path ──────────────────────────────────

describe('extractTimelineForSlugs — happy path', () => {
  beforeEach(truncateAll);

  test('extracts timeline entries for requested slugs', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice is CEO.

## Timeline
- **2026-01-15** | Role — Joined as CEO
- **2026-02-20** | Funding — Closed Series A`);

    const created = await extractTimelineForSlugs(engine, brainDir, ['people/alice']);

    expect(created).toBe(2);
    const entries = await engine.getTimeline('people/alice');
    expect(entries.length).toBe(2);
    expect(entries.map(e => e.summary).sort()).toEqual(['Closed Series A', 'Joined as CEO']);
  });

  test('processes multiple slugs in one call', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Meeting — Alice event`);
    await writePage('people/bob', `---\ntype: person\n---\nBob.

## Timeline
- **2026-03-10** | Meeting — Bob event`);

    const created = await extractTimelineForSlugs(engine, brainDir, ['people/alice', 'people/bob']);

    expect(created).toBe(2);
    const aliceEntries = await engine.getTimeline('people/alice');
    const bobEntries = await engine.getTimeline('people/bob');
    expect(aliceEntries.length).toBe(1);
    expect(bobEntries.length).toBe(1);
    expect(aliceEntries[0].summary).toBe('Alice event');
    expect(bobEntries[0].summary).toBe('Bob event');
  });
});

// ─── extractTimelineForSlugs — empty/missing ───────────────────────────────

describe('extractTimelineForSlugs — empty/missing', () => {
  beforeEach(truncateAll);

  test('returns 0 for empty slugs array', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Event`);

    const created = await extractTimelineForSlugs(engine, brainDir, []);

    expect(created).toBe(0);
    const entries = await engine.getTimeline('people/alice');
    expect(entries.length).toBe(0);
  });

  test('silently skips missing files', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Event`);

    const created = await extractTimelineForSlugs(engine, brainDir, ['people/ghost']);

    expect(created).toBe(0);
  });

  test('partial match: processes existing, skips missing', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Meeting — Alice event`);

    const created = await extractTimelineForSlugs(engine, brainDir, [
      'people/alice', 'people/ghost', 'companies/phantom',
    ]);

    expect(created).toBe(1);
    const entries = await engine.getTimeline('people/alice');
    expect(entries.length).toBe(1);
  });

  test('all missing slugs returns 0', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Event`);

    const created = await extractTimelineForSlugs(engine, brainDir, [
      'people/ghost', 'companies/phantom',
    ]);

    expect(created).toBe(0);
  });
});

// ─── extractTimelineForSlugs — engine reuse ────────────────────────────────

describe('extractTimelineForSlugs — engine reuse', () => {
  beforeEach(truncateAll);

  test('same engine can be used across multiple calls', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Meeting — Alice event`);

    const c1 = await extractTimelineForSlugs(engine, brainDir, ['people/alice']);
    expect(c1).toBe(1);

    const c2 = await extractTimelineForSlugs(engine, brainDir, ['people/alice']);
    expect(c2).toBe(1);

    // Idempotent via DB constraint.
    const entries = await engine.getTimeline('people/alice');
    expect(entries.length).toBe(1);
  });

  test('engine state persists between calls', async () => {
    await writePage('people/alice', `---\ntype: person\n---\nAlice.

## Timeline
- **2026-01-15** | Meeting — Alice event`);
    await writePage('people/bob', `---\ntype: person\n---\nBob.

## Timeline
- **2026-03-10** | Meeting — Bob event`);

    await extractTimelineForSlugs(engine, brainDir, ['people/alice']);
    expect((await engine.getTimeline('people/alice')).length).toBe(1);

    await extractTimelineForSlugs(engine, brainDir, ['people/bob']);
    expect((await engine.getTimeline('people/bob')).length).toBe(1);

    // Both should exist in the same engine.
    expect((await engine.getTimeline('people/alice')).length).toBe(1);
    expect((await engine.getTimeline('people/bob')).length).toBe(1);
  });
});

// ─── Integration: both functions on same repo ──────────────────────────────

describe('extractLinksForSlugs + extractTimelineForSlugs — integration', () => {
  beforeEach(truncateAll);

  test('both functions work on the same repo with same engine', async () => {
    await writePage('people/alice', `---\ntype: person\n---\n[Alice](../people/alice.md) is CEO.

## Timeline
- **2026-01-15** | Role — Joined as CEO`);
    await writePage('companies/acme', `---\ntype: company\n---\n[Alice](../people/alice.md) leads Acme.`);

    const linkCreated = await extractLinksForSlugs(engine, brainDir, ['companies/acme']);
    const timelineCreated = await extractTimelineForSlugs(engine, brainDir, ['people/alice']);

    expect(linkCreated).toBe(1);
    expect(timelineCreated).toBe(1);

    const links = await engine.getLinks('companies/acme');
    const entries = await engine.getTimeline('people/alice');
    expect(links.length).toBe(1);
    expect(entries.length).toBe(1);
  });
});
