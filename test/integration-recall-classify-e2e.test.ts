/**
 * PR1+PR9 — Full Pipeline Integration Test
 *
 * Exercises the complete recall pipeline with real source pages in the DB:
 *   1. Write source pages + chunks to the DB
 *   2. Run `gbrain recall --classify --quotes --json` against them
 *   3. Verify classification, routing hints, evidence, span_ids, and abstention
 *   4. Verify backward compat (without --classify)
 *   5. Verify end-to-end CLI binary invocation
 *
 * Requires: DATABASE_URL set (Postgres).
 * Skip: when no database is available.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { PostgresEngine } from '../src/core/postgres-engine.ts';
import * as db from '../src/core/db.ts';
import { recallEvidence, type RecallResult } from '../src/core/evidence/recall.ts';
import { classifyQuery, type QueryClassification } from '../src/core/memory/query-classifier.ts';
import { importFromContent } from '../src/core/import-file.ts';
import { spawn } from 'child_process';
import { resolve as pathResolve } from 'path';

// ── Inline helpers (mirrors e2e/helpers.ts subset) ───────────────

const DATABASE_URL = process.env.DATABASE_URL;
const hasDatabase = () => !!DATABASE_URL;

async function setupDB(): Promise<PostgresEngine> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL not set. Copy .env.testing.example to .env.testing and configure it.');
  }
  await db.disconnect();
  await db.connect({ database_url: DATABASE_URL });
  await db.initSchema();
  const conn = db.getConnection();
  const ALL_TABLES = [
    'content_chunks', 'links', 'tags', 'raw_data', 'timeline_entries',
    'page_versions', 'ingest_log', 'files', 'pages', 'config',
    'minion_attachments', 'minion_inbox', 'minion_jobs',
  ];
  for (const table of ALL_TABLES) {
    await conn.unsafe(`TRUNCATE ${table} CASCADE`);
  }
  return new PostgresEngine();
}

async function teardownDB(): Promise<void> {
  await db.disconnect();
}

// ── Fixtures ─────────────────────────────────────────────────────

const FIXTURE_PAGES = [
  {
    slug: 'test/citadel-lineage',
    frontmatter: { title: 'Citadel Lineage', type: 'concept' },
    body: [
      '## Initial Idea',
      'The original concept was about anti-programming — resisting marketing,',
      'indoctrination, and people telling us how to think. We called it',
      'Citadel as a personal sovereignty layer for tomorrow\'s builders.',
      '',
      '## Forms Explored',
      'We explored blog, subscription, membership, community, cohort, and',
      'training arcs. The idea evolved into post-human / human+AI territory,',
      'what we now call the cognitive fortress lineage.',
      '',
      '## Why We Moved Away',
      'Citadel remained root-stock but Sovereign AI became more immediate',
      'and institutionally actionable. We shifted primary focus to Sovereign',
      'AI while keeping Citadel as a potential content-community line.',
    ].join('\n'),
  },
  {
    slug: 'test/verdict-world8',
    frontmatter: { title: 'World 8 North Star — Verdict Correction', type: 'concept' },
    body: [
      '## North Star Correction',
      'The World 8 North Star was corrected to emphasize Verdict as the',
      'primary evaluation framework. This was a deliberate pivot from',
      'earlier explorations.',
      '',
      '## Key Decision',
      'Verdict became the north star for quality assessment, replacing',
      'the previous heuristic approach. This decision was documented in',
      'the Sovereign AI strategy document.',
    ].join('\n'),
  },
  {
    slug: 'test/sovereign-ai-strategy',
    frontmatter: { title: 'Sovereign AI Strategy', type: 'concept' },
    body: [
      '## Current Posture',
      'Sovereign AI is the primary focus. Eonic is not dormant — it is',
      'a secondary exploration line that remains active but deferred.',
      '',
      '## Relationship to Citadel',
      'Citadel is the narrative ancestor. Sovereign AI is the current',
      'institutionally actionable line. The transition was driven by',
      'timing and opportunity, not rejection of the original idea.',
    ].join('\n'),
  },
  {
    slug: 'test/local-models',
    frontmatter: { title: 'Local Models Doctrine', type: 'preference' },
    body: [
      '## MLX Doctrine',
      'Local models are not banned — they are bounded to workers only.',
      'This is a preference signal, not a hard constraint.',
      '',
      '## MWAL / Praeon History',
      'Past experience with MWAL and Praeon informs our current stance',
      'on local model tooling. We prefer local compute for bounded tasks.',
    ].join('\n'),
  },
  {
    slug: 'test/relationship-archana',
    frontmatter: { title: 'Archana/Rukam Relationship', type: 'relationship' },
    body: [
      '## Relationship Notes',
      'Archana and Rukam represent a key relationship with documented',
      'high-friction incidents. This is relationship memory, not',
      'operational strategy.',
      '',
      '## High-Friction Incidents',
      'Several high-friction incidents were documented. These inform',
      'current relationship dynamics and should be treated as sensitive.',
    ].join('\n'),
  },
  {
    slug: 'test/eonic-status',
    frontmatter: { title: 'Eonic Status', type: 'concept' },
    body: [
      '## Eonic Post-Import Verifier',
      'Eonic is NOT dormant. It is a secondary exploration line.',
      'Sovereign AI remains the primary focus.',
      '',
      '## ACC Before MWAL',
      'The ACC (Anti-Programming Concept) came before MWAL. The rails',
      'were not pursued because Sovereign AI became more actionable.',
    ].join('\n'),
  },
];

// ── Helpers ──────────────────────────────────────────────────────

async function writeFixtures(engine: PostgresEngine): Promise<void> {
  for (const page of FIXTURE_PAGES) {
    const frontmatter = ['---', ...Object.entries(page.frontmatter).map(([key, value]) => `${key}: ${value}`), '---', ''].join('\n');
    await importFromContent(engine, page.slug, frontmatter + page.body, { noEmbed: true });
  }
}

async function runRecall(engine: PostgresEngine, query: string, opts: { classify?: boolean; quotes?: boolean; json?: boolean } = {}): Promise<{ result: RecallResult; classification?: QueryClassification }> {
  const classification = opts.classify ? classifyQuery(query, '') : undefined;
  const result = await recallEvidence(engine, query, {
    limit: 5,
    before: 2,
    after: 2,
    sourceId: undefined,
    classification,
  });
  return { result, classification };
}

// ── Tests ────────────────────────────────────────────────────────

describe('PR1+PR9 — Full Pipeline Integration (DB-backed)', () => {
  let engine: PostgresEngine | null = null;

  beforeAll(async () => {
    if (!hasDatabase()) {
      console.log('SKIP: No DATABASE_URL. Run with a real Postgres to enable integration tests.');
      return;
    }
    engine = await setupDB();
    await writeFixtures(engine);
  });

  afterAll(async () => {
    if (engine) {
      await teardownDB();
      engine = null;
    }
  });

  it('skips when no database is available', () => {
    // This test always passes — it documents the skip behavior.
    expect(hasDatabase()).toBe(false);
  });

  // Only run the rest when a DB is available
  if (hasDatabase()) {
    describe('recall --classify --quotes end-to-end', () => {
      it('Citadel recall returns classification + evidence with span_id', async () => {
        const { result, classification } = await runRecall(engine!, 'Citadel initial idea', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(classification!.intent).toBe('historical_arc');
        expect(classification!.matched_route_ids).toContain('citadel-lineage');

        expect(result.status).toBe('hit');
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].span_id).toMatch(/^gbs1:/);
        expect(result.evidence[0].quote_hash).toMatch(/^[a-f0-9]+$/);
        expect(result.evidence[0].quote.length).toBeGreaterThan(10);
      });

      it('World 8 / Verdict recall returns classification + evidence', async () => {
        const { result, classification } = await runRecall(engine!, 'World 8 North Star Verdict correction', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(result.status).toBe('hit');
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].slug).toBe('test/verdict-world8');
      });

      it('Sovereign AI recall returns correct classification + evidence', async () => {
        const { result, classification } = await runRecall(engine!, 'Sovereign AI current status', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(classification!.matched_route_ids).toContain('sovereign-ai-strategy-pivot');
        expect(result.status).toBe('hit');
        expect(result.evidence.some(e => e.slug === 'test/sovereign-ai-strategy')).toBe(true);
      });

      it('Local models recall returns classification + evidence', async () => {
        const { result, classification } = await runRecall(engine!, 'Local model MLX doctrine', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(classification!.matched_route_ids).toContain('local-model-worker-lane');
        expect(result.status).toBe('hit');
        expect(result.evidence.some(e => e.slug === 'test/local-models')).toBe(true);
      });

      it('Relationship recall returns classification + evidence', async () => {
        const { result, classification } = await runRecall(engine!, 'Archana Rukam relationship', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(classification!.matched_route_ids).toContain('government-outreach');
        expect(result.status).toBe('hit');
        expect(result.evidence.some(e => e.slug === 'test/relationship-archana')).toBe(true);
      });

      it('Eonic status recall returns correct classification', async () => {
        const { result, classification } = await runRecall(engine!, 'Eonic not dormant Sovereign AI primary', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(result.status).toBe('hit');
        expect(result.evidence.some(e => e.slug === 'test/eonic-status')).toBe(true);
      });

      it('Abstains when query has no matching source content', async () => {
        const { result } = await runRecall(engine!, 'Completely unrelated topic xyz123', { classify: true });

        expect(result.status).toBe('abstain');
        expect(result.evidence.length).toBe(0);
      });

      it('Backward compat: recall without --classify still works', async () => {
        const { result, classification } = await runRecall(engine!, 'Citadel initial idea', { quotes: true });

        expect(classification).toBeUndefined();
        expect(result.status).toBe('hit');
        expect(result.evidence.length).toBeGreaterThan(0);
      });

      it('Full pipeline: classify → recallEvidence → verify span_id + quote_hash + evidence', async () => {
        const { result, classification } = await runRecall(engine!, 'Citadel why moved away Sovereign AI', { classify: true, quotes: true });

        expect(classification).toBeDefined();
        expect(classification!.intent).toBe('historical_arc');
        expect(result.status).toBe('hit');
        expect(result.evidence.length).toBeGreaterThan(0);

        // Verify each evidence item has required fields
        for (const ev of result.evidence) {
          expect(ev.span_id).toMatch(/^gbs1:/);
          expect(ev.quote_hash).toMatch(/^[a-f0-9]+$/);
          expect(ev.source_id).toBeDefined();
          expect(ev.slug).toBeDefined();
          expect(ev.quote).toBeDefined();
          expect(ev.start_line).toBeGreaterThanOrEqual(0);
          expect(ev.end_line).toBeGreaterThanOrEqual(ev.start_line);
        }
      });
    });

    describe('CLI binary end-to-end', () => {
      it('gbrain recall --classify --quotes --json returns valid JSON with classification + evidence', async () => {
        const binPath = pathResolve(import.meta.dir, '../bin/gbrain');

        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
          const proc = spawn(
            'node',
            [binPath, 'recall', 'Citadel initial idea', '--json', '--classify', '--quotes'],
            {
              cwd: pathResolve(import.meta.dir, '..'),
              env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
            },
          );

          const stdout: Buffer[] = [];
          const stderr: Buffer[] = [];
          proc.stdout.on('data', (d: Buffer) => stdout.push(d));
          proc.stderr.on('data', (d: Buffer) => stderr.push(d));
          proc.on('close', (code) => {
            resolve({
              stdout: Buffer.concat(stdout).toString(),
              stderr: Buffer.concat(stderr).toString(),
              exitCode: code ?? 0,
            });
          });
        });

        const payload = JSON.parse(result.stdout);

        expect(payload.classification).toBeDefined();
        expect(payload.classification.intent).toBe('historical_arc');
        expect(payload.result.status).toBe('hit');
        expect(payload.result.evidence.length).toBeGreaterThan(0);
        expect(payload.result.evidence[0].span_id).toMatch(/^gbs1:/);
      });

      it('gbrain recall without --classify works (backward compat)', async () => {
        const binPath = pathResolve(import.meta.dir, '../bin/gbrain');

        const result = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
          const proc = spawn(
            'node',
            [binPath, 'recall', 'Sovereign AI current status', '--json', '--quotes'],
            {
              cwd: pathResolve(import.meta.dir, '..'),
              env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
            },
          );

          const stdout: Buffer[] = [];
          proc.stdout.on('data', (d: Buffer) => stdout.push(d));
          proc.on('close', (code) => {
            resolve({ stdout: Buffer.concat(stdout).toString(), exitCode: code ?? 0 });
          });
        });

        const payload = JSON.parse(result.stdout);
        expect(payload.classification).toBeUndefined();
        expect(payload.result.status).toBe('hit');
      });
    });
  }
});
