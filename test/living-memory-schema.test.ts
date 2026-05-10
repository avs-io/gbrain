import { describe, test, expect, afterEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { MIGRATIONS, LATEST_VERSION } from '../src/core/migrate.ts';
import { parseExpectedColumns } from '../src/core/schema-verify.ts';

const FIRST_CLASS_TABLES = [
  'source_items',
  'evidence_spans',
  'episodes',
  'entities',
  'entity_mentions',
  'claims',
  'claim_evidence',
  'claim_edges',
  'memory_atoms',
  'scout_runs',
  'scout_observations',
  'surfacing_candidates',
] as const;

async function newEngine(): Promise<PGLiteEngine> {
  const engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  return engine;
}

describe('SMC-08 living memory intelligence DB schema', () => {
  let engine: PGLiteEngine | null = null;

  afterEach(async () => {
    if (engine) await engine.disconnect();
    engine = null;
  });

  test('v30 migration is registered as the latest first-class schema migration', () => {
    const v30 = MIGRATIONS.find(m => m.version === 30);
    expect(v30).toBeDefined();
    expect(v30!.name).toBe('living_memory_intelligence_model');
    expect(v30!.sql).toBe('');
    expect(v30!.sqlFor?.postgres).toContain('CREATE TABLE IF NOT EXISTS source_items');
    expect(v30!.sqlFor?.postgres).toContain('ALTER TABLE source_items ENABLE ROW LEVEL SECURITY');
    expect(v30!.sqlFor?.pglite).toContain('CREATE TABLE IF NOT EXISTS surfacing_candidates');
    for (const table of FIRST_CLASS_TABLES) {
      expect(v30!.sqlFor?.pglite).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(LATEST_VERSION).toBe(30);
  });

  test('schema verifier parses the first-class tables and key columns from schema-embedded', () => {
    const parsed = parseExpectedColumns();
    const tableSet = new Set(parsed.map(c => c.table));
    for (const table of FIRST_CLASS_TABLES) {
      expect(tableSet.has(table)).toBe(true);
    }

    const columns = new Set(parsed.map(c => `${c.table}.${c.column}`));
    for (const key of [
      'source_items.metadata',
      'evidence_spans.location',
      'entities.aliases',
      'entity_mentions.evidence_span_id',
      'claims.statement',
      'claim_evidence.stance',
      'claim_edges.edge_type',
      'memory_atoms.content',
      'scout_runs.query',
      'scout_observations.observation_text',
      'surfacing_candidates.status',
    ]) {
      expect(columns.has(key)).toBe(true);
    }
  });

  test('PGLite initSchema creates tables, indexes, and foreign keys locally', async () => {
    engine = await newEngine();
    const db = (engine as any).db;

    const rows = (await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${FIRST_CLASS_TABLES.map(t => `'${t}'`).join(', ')})
    `)).rows as { table_name: string }[];
    expect(new Set(rows.map(r => r.table_name))).toEqual(new Set(FIRST_CLASS_TABLES));

    const indexes = (await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_source_items_namespace_privacy',
          'idx_evidence_spans_source_item',
          'idx_entity_mentions_span',
          'idx_claim_evidence_claim',
          'idx_memory_atoms_salience',
          'idx_scout_observations_run',
          'idx_surfacing_candidates_status'
        )
    `)).rows as { indexname: string }[];
    expect(indexes.length).toBe(7);

    const fkRows = (await db.query(`
      SELECT conrelid::regclass::text AS table_name, count(*)::int AS n
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid IN (
          'evidence_spans'::regclass,
          'entity_mentions'::regclass,
          'claim_evidence'::regclass,
          'claim_edges'::regclass,
          'memory_atoms'::regclass,
          'scout_observations'::regclass,
          'surfacing_candidates'::regclass
        )
      GROUP BY conrelid
    `)).rows as { table_name: string; n: number }[];
    const fkCounts = new Map(fkRows.map(r => [r.table_name, r.n]));
    expect(fkCounts.get('evidence_spans')).toBeGreaterThanOrEqual(1);
    expect(fkCounts.get('entity_mentions')).toBeGreaterThanOrEqual(2);
    expect(fkCounts.get('claim_evidence')).toBeGreaterThanOrEqual(2);
    expect(fkCounts.get('claim_edges')).toBeGreaterThanOrEqual(2);
    expect(fkCounts.get('memory_atoms')).toBeGreaterThanOrEqual(5);
    expect(fkCounts.get('scout_observations')).toBeGreaterThanOrEqual(1);
    expect(fkCounts.get('surfacing_candidates')).toBeGreaterThanOrEqual(1);
  });

  test('JSONB columns store real objects/arrays and relational inserts round-trip', async () => {
    engine = await newEngine();
    const db = (engine as any).db;

    const sourceItem = (await db.query(`
      INSERT INTO source_items (source_type, source_ref, title, metadata)
      VALUES ('unit', 'smc-08-source', 'SMC-08 Source', $1::jsonb)
      RETURNING id
    `, [JSON.stringify({ channel: 'fixture' })])).rows[0] as { id: number };

    const span = (await db.query(`
      INSERT INTO evidence_spans (source_item_id, span_ref, quote, location, metadata)
      VALUES ($1, 'span-1', 'Chief wants evidence-backed first-class memory tables.', $2::jsonb, $3::jsonb)
      RETURNING id
    `, [sourceItem.id, JSON.stringify({ line_start: 1, line_end: 1 }), JSON.stringify({ exact_quote: true })])).rows[0] as { id: number };

    const episode = (await db.query(`
      INSERT INTO episodes (title, summary, salience, metadata)
      VALUES ('SMC-08 repair', 'First-class schema repair', 0.8, $1::jsonb)
      RETURNING id
    `, [JSON.stringify({ lane: 'audit' })])).rows[0] as { id: number };

    const entity = (await db.query(`
      INSERT INTO entities (entity_type, canonical_name, aliases, metadata)
      VALUES ('system', 'GBrain', $1::jsonb, $2::jsonb)
      RETURNING id
    `, [JSON.stringify(['gbrain']), JSON.stringify({ kind: 'memory-engine' })])).rows[0] as { id: number };

    await db.query(`
      INSERT INTO entity_mentions (entity_id, source_item_id, evidence_span_id, surface_text, metadata)
      VALUES ($1, $2, $3, 'GBrain', $4::jsonb)
    `, [entity.id, sourceItem.id, span.id, JSON.stringify({ extractor: 'unit' })]);

    const claim = (await db.query(`
      INSERT INTO claims (statement, claim_type, status, confidence, metadata)
      VALUES ('GBrain has first-class living memory schema tables.', 'schema', 'review_only', 0.9, $1::jsonb)
      RETURNING id
    `, [JSON.stringify({ row: 'SMC-08' })])).rows[0] as { id: number };

    const relatedClaim = (await db.query(`
      INSERT INTO claims (statement, claim_type, status, confidence)
      VALUES ('Schema repairs should preserve evidence spans.', 'schema', 'review_only', 0.7)
      RETURNING id
    `)).rows[0] as { id: number };

    await db.query(`
      INSERT INTO claim_evidence (claim_id, evidence_span_id, source_item_id, stance, metadata)
      VALUES ($1, $2, $3, 'supports', $4::jsonb)
    `, [claim.id, span.id, sourceItem.id, JSON.stringify({ support: 'direct' })]);

    await db.query(`
      INSERT INTO claim_edges (from_claim_id, to_claim_id, edge_type, metadata)
      VALUES ($1, $2, 'related_to', $3::jsonb)
    `, [claim.id, relatedClaim.id, JSON.stringify({ relation: 'schema' })]);

    const atom = (await db.query(`
      INSERT INTO memory_atoms (atom_type, content, confidence, salience, entity_id, episode_id, claim_id, source_item_id, evidence_span_id, metadata)
      VALUES ('preference', 'Use evidence-backed memory repairs.', 0.85, 0.75, $1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id
    `, [entity.id, episode.id, claim.id, sourceItem.id, span.id, JSON.stringify({ promotion: 'review_only' })])).rows[0] as { id: number };

    const run = (await db.query(`
      INSERT INTO scout_runs (run_key, scout_type, status, query, metadata)
      VALUES ('smc-08-run', 'schema', 'complete', $1::jsonb, $2::jsonb)
      RETURNING id
    `, [JSON.stringify({ topic: 'living-memory' }), JSON.stringify({ fixture: true })])).rows[0] as { id: number };

    await db.query(`
      INSERT INTO scout_observations (scout_run_id, source_item_id, evidence_span_id, observation_type, observation_text, score, metadata)
      VALUES ($1, $2, $3, 'schema_signal', 'Required tables now exist.', 0.88, $4::jsonb)
    `, [run.id, sourceItem.id, span.id, JSON.stringify({ observed_by: 'unit' })]);

    await db.query(`
      INSERT INTO surfacing_candidates (memory_atom_id, claim_id, entity_id, episode_id, source_item_id, candidate_type, reason, score, metadata)
      VALUES ($1, $2, $3, $4, $5, 'audit_recommendation', 'Reducer can review SMC-08 evidence.', 0.91, $6::jsonb)
    `, [atom.id, claim.id, entity.id, episode.id, sourceItem.id, JSON.stringify({ next_state: 'reducer_pending' })]);

    const sanity = (await db.query(`
      SELECT
        (SELECT jsonb_typeof(metadata) FROM source_items WHERE id = $1) AS source_item_metadata,
        (SELECT jsonb_typeof(location) FROM evidence_spans WHERE id = $2) AS evidence_location,
        (SELECT jsonb_typeof(aliases) FROM entities WHERE id = $3) AS entity_aliases,
        (SELECT jsonb_typeof(metadata) FROM claims WHERE id = $4) AS claim_metadata,
        (SELECT jsonb_typeof(metadata) FROM memory_atoms WHERE id = $5) AS atom_metadata,
        (SELECT jsonb_typeof(query) FROM scout_runs WHERE id = $6) AS scout_query,
        (SELECT jsonb_typeof(metadata) FROM surfacing_candidates WHERE memory_atom_id = $5) AS surfacing_metadata
    `, [sourceItem.id, span.id, entity.id, claim.id, atom.id, run.id])).rows[0] as Record<string, string>;

    expect(sanity).toEqual({
      source_item_metadata: 'object',
      evidence_location: 'object',
      entity_aliases: 'array',
      claim_metadata: 'object',
      atom_metadata: 'object',
      scout_query: 'object',
      surfacing_metadata: 'object',
    });
  });

  test('v30 DDL is idempotent when re-run against an initialized local DB', async () => {
    engine = await newEngine();
    const db = (engine as any).db;
    const v30 = MIGRATIONS.find(m => m.version === 30)!;
    const sql = v30.sqlFor!.pglite!;

    await db.exec(sql);
    await db.exec(sql);

    const rows = (await db.query(`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${FIRST_CLASS_TABLES.map(t => `'${t}'`).join(', ')})
    `)).rows as { n: number }[];
    expect(rows[0].n).toBe(FIRST_CLASS_TABLES.length);
  });
});
