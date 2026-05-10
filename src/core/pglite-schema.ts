/**
 * PGLite schema — derived from schema-embedded.ts (Postgres schema).
 *
 * Differences from Postgres:
 * - No RLS block (no role system in embedded PGLite)
 * - No access_tokens / mcp_request_log (local-only, no remote auth)
 * - No files table (file attachments require Supabase Storage)
 * - No pg_advisory_lock (single connection)
 *
 * Everything else is identical: same tables, triggers, indexes, pgvector HNSW, tsvector GIN.
 *
 * DRIFT WARNING: When schema-embedded.ts changes, update this file to match.
 * test/edge-bundle.test.ts has a drift detection test.
 */

export const PGLITE_SCHEMA_SQL = `
-- GBrain PGLite schema (local embedded Postgres)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- sources: multi-brain tenancy (v0.18.0). See src/schema.sql for design notes.
-- ============================================================
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  local_path    TEXT,
  last_commit   TEXT,
  last_sync_at  TIMESTAMPTZ,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sources (id, name, config)
  VALUES ('default', 'default', '{"federated": true}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- pages: the core content table
-- ============================================================
-- v0.18.0 (Step 2): source_id scopes each page. Slugs are unique per
-- source — see src/schema.sql for the design notes.
CREATE TABLE IF NOT EXISTS pages (
  id            SERIAL PRIMARY KEY,
  source_id     TEXT    NOT NULL DEFAULT 'default'
                REFERENCES sources(id) ON DELETE CASCADE,
  slug          TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  -- v0.19.0: markdown vs code distinction at the DB level.
  page_kind     TEXT    NOT NULL DEFAULT 'markdown'
                CHECK (page_kind IN ('markdown','code')),
  title         TEXT    NOT NULL,
  compiled_truth TEXT   NOT NULL DEFAULT '',
  timeline      TEXT    NOT NULL DEFAULT '',
  frontmatter   JSONB   NOT NULL DEFAULT '{}',
  content_hash  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pages_source_slug_key UNIQUE (source_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_frontmatter ON pages USING GIN(frontmatter);
CREATE INDEX IF NOT EXISTS idx_pages_trgm ON pages USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);

-- ============================================================
-- content_chunks: chunked content with embeddings
-- ============================================================
CREATE TABLE IF NOT EXISTS content_chunks (
  id            SERIAL PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT    NOT NULL,
  chunk_source  TEXT    NOT NULL DEFAULT 'compiled_truth',
  embedding     vector(1536),
  model         TEXT    NOT NULL DEFAULT 'text-embedding-3-large',
  token_count   INTEGER,
  embedded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- v0.19.0: code chunk metadata (markdown chunks leave NULL).
  language      TEXT,
  symbol_name   TEXT,
  symbol_type   TEXT,
  start_line    INTEGER,
  end_line      INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_page_index ON content_chunks(page_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON content_chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON content_chunks USING hnsw (embedding vector_cosine_ops);
-- v0.19.0: partial indexes for code chunk lookups.
CREATE INDEX IF NOT EXISTS idx_chunks_symbol_name ON content_chunks(symbol_name) WHERE symbol_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_language ON content_chunks(language) WHERE language IS NOT NULL;

-- ============================================================
-- links: cross-references between pages
-- ============================================================
-- See src/schema.sql for full design notes on link_source + origin_page_id.
CREATE TABLE IF NOT EXISTS links (
  id             SERIAL PRIMARY KEY,
  from_page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  link_type      TEXT    NOT NULL DEFAULT '',
  context        TEXT    NOT NULL DEFAULT '',
  link_source    TEXT    CHECK (link_source IS NULL OR link_source IN ('markdown', 'frontmatter', 'manual')),
  origin_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  origin_field   TEXT,
  -- v0.18.0 Step 4: see src/schema.sql.
  resolution_type TEXT   CHECK (resolution_type IS NULL OR resolution_type IN ('qualified', 'unqualified')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT links_from_to_type_source_origin_unique
    UNIQUE NULLS NOT DISTINCT (from_page_id, to_page_id, link_type, link_source, origin_page_id)
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_page_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_page_id);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(link_source);
CREATE INDEX IF NOT EXISTS idx_links_origin ON links(origin_page_id);

-- ============================================================
-- tags
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id      SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_page_id ON tags(page_id);

-- ============================================================
-- raw_data: sidecar data
-- ============================================================
CREATE TABLE IF NOT EXISTS raw_data (
  id         SERIAL PRIMARY KEY,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,
  data       JSONB   NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id, source)
);

CREATE INDEX IF NOT EXISTS idx_raw_data_page ON raw_data(page_id);

-- ============================================================
-- timeline_entries: structured timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS timeline_entries (
  id       SERIAL PRIMARY KEY,
  page_id  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  date     DATE    NOT NULL,
  source   TEXT    NOT NULL DEFAULT '',
  summary  TEXT    NOT NULL,
  detail   TEXT    NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_page ON timeline_entries(page_id);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_entries(date);
-- Dedup constraint: same (page, date, summary) treated as same event
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_dedup ON timeline_entries(page_id, date, summary);

-- ============================================================
-- page_versions: snapshot history
-- ============================================================
CREATE TABLE IF NOT EXISTS page_versions (
  id             SERIAL PRIMARY KEY,
  page_id        INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  compiled_truth TEXT    NOT NULL,
  frontmatter    JSONB   NOT NULL DEFAULT '{}',
  snapshot_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_versions_page ON page_versions(page_id);

-- ============================================================
-- ingest_log (v0.18.0 Step 1: source_id deferred to v17, see src/schema.sql)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingest_log (
  id            SERIAL PRIMARY KEY,
  source_type   TEXT    NOT NULL,
  source_ref    TEXT    NOT NULL,
  pages_updated JSONB   NOT NULL DEFAULT '[]',
  summary       TEXT    NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- config: brain-level settings
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO config (key, value) VALUES
  ('version', '1'),
  ('engine', 'pglite'),
  ('embedding_model', 'text-embedding-3-large'),
  ('embedding_dimensions', '1536'),
  ('chunk_strategy', 'semantic')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Minion Jobs: BullMQ-inspired Postgres-native job queue
-- ============================================================
CREATE TABLE IF NOT EXISTS minion_jobs (
  id               SERIAL PRIMARY KEY,
  name             TEXT        NOT NULL,
  queue            TEXT        NOT NULL DEFAULT 'default',
  status           TEXT        NOT NULL DEFAULT 'waiting',
  priority         INTEGER     NOT NULL DEFAULT 0,
  data             JSONB       NOT NULL DEFAULT '{}',
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  attempts_made    INTEGER     NOT NULL DEFAULT 0,
  attempts_started INTEGER     NOT NULL DEFAULT 0,
  backoff_type     TEXT        NOT NULL DEFAULT 'exponential',
  backoff_delay    INTEGER     NOT NULL DEFAULT 1000,
  backoff_jitter   REAL        NOT NULL DEFAULT 0.2,
  stalled_counter  INTEGER     NOT NULL DEFAULT 0,
  max_stalled      INTEGER     NOT NULL DEFAULT 5,
  lock_token       TEXT,
  lock_until       TIMESTAMPTZ,
  delay_until      TIMESTAMPTZ,
  parent_job_id    INTEGER     REFERENCES minion_jobs(id) ON DELETE SET NULL,
  on_child_fail    TEXT        NOT NULL DEFAULT 'fail_parent',
  tokens_input     INTEGER     NOT NULL DEFAULT 0,
  tokens_output    INTEGER     NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER    NOT NULL DEFAULT 0,
  depth            INTEGER     NOT NULL DEFAULT 0,
  max_children     INTEGER,
  timeout_ms       INTEGER,
  timeout_at       TIMESTAMPTZ,
  remove_on_complete BOOLEAN   NOT NULL DEFAULT FALSE,
  remove_on_fail   BOOLEAN     NOT NULL DEFAULT FALSE,
  idempotency_key  TEXT,
  result           JSONB,
  progress         JSONB,
  error_text       TEXT,
  stacktrace       JSONB       DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_status CHECK (status IN ('waiting','active','completed','failed','delayed','dead','cancelled','waiting-children','paused')),
  CONSTRAINT chk_backoff_type CHECK (backoff_type IN ('fixed','exponential')),
  CONSTRAINT chk_on_child_fail CHECK (on_child_fail IN ('fail_parent','remove_dep','ignore','continue')),
  CONSTRAINT chk_jitter_range CHECK (backoff_jitter >= 0.0 AND backoff_jitter <= 1.0),
  CONSTRAINT chk_attempts_order CHECK (attempts_made <= attempts_started),
  CONSTRAINT chk_nonnegative CHECK (attempts_made >= 0 AND attempts_started >= 0 AND stalled_counter >= 0 AND max_attempts >= 1 AND max_stalled >= 0),
  CONSTRAINT chk_depth_nonnegative CHECK (depth >= 0),
  CONSTRAINT chk_max_children_positive CHECK (max_children IS NULL OR max_children > 0),
  CONSTRAINT chk_timeout_positive CHECK (timeout_ms IS NULL OR timeout_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_minion_jobs_claim ON minion_jobs (queue, priority ASC, created_at ASC) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_minion_jobs_status ON minion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_minion_jobs_stalled ON minion_jobs (lock_until) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_minion_jobs_delayed ON minion_jobs (delay_until) WHERE status = 'delayed';
CREATE INDEX IF NOT EXISTS idx_minion_jobs_parent ON minion_jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS idx_minion_jobs_timeout ON minion_jobs (timeout_at)
  WHERE status = 'active' AND timeout_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_minion_jobs_parent_status ON minion_jobs (parent_job_id, status)
  WHERE parent_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_minion_jobs_idempotency ON minion_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Inbox table for sidechannel messaging
CREATE TABLE IF NOT EXISTS minion_inbox (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_minion_inbox_unread ON minion_inbox (job_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_minion_inbox_child_done ON minion_inbox (job_id, sent_at)
  WHERE (payload->>'type') = 'child_done';

-- Attachment manifest (BYTEA inline + forward-compat storage_uri)
CREATE TABLE IF NOT EXISTS minion_attachments (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  content       BYTEA,
  storage_uri   TEXT,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_minion_attachments_job_filename UNIQUE (job_id, filename),
  CONSTRAINT chk_attachment_storage CHECK (content IS NOT NULL OR storage_uri IS NOT NULL),
  CONSTRAINT chk_attachment_size CHECK (size_bytes >= 0)
);
CREATE INDEX IF NOT EXISTS idx_minion_attachments_job ON minion_attachments (job_id);
-- NOTE: SET STORAGE EXTERNAL is omitted on PGLite; it's a Postgres TOAST optimization
-- and PGLite may not support it. Postgres path applies it via migration v7.

-- ============================================================
-- Subagent runtime (v0.16.0) — durable LLM loops
-- ============================================================
CREATE TABLE IF NOT EXISTS subagent_messages (
  id                  BIGSERIAL PRIMARY KEY,
  job_id              BIGINT      NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  message_idx         INTEGER     NOT NULL,
  role                TEXT        NOT NULL,
  content_blocks      JSONB       NOT NULL,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  tokens_cache_read   INTEGER,
  tokens_cache_create INTEGER,
  model               TEXT,
  ended_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_subagent_messages_idx UNIQUE (job_id, message_idx),
  CONSTRAINT chk_subagent_messages_role CHECK (role IN ('user','assistant'))
);
CREATE INDEX IF NOT EXISTS idx_subagent_messages_job ON subagent_messages (job_id, message_idx);

CREATE TABLE IF NOT EXISTS subagent_tool_executions (
  id           BIGSERIAL PRIMARY KEY,
  job_id       BIGINT      NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  message_idx  INTEGER     NOT NULL,
  tool_use_id  TEXT        NOT NULL,
  tool_name    TEXT        NOT NULL,
  input        JSONB       NOT NULL,
  status       TEXT        NOT NULL,
  output       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  CONSTRAINT uniq_subagent_tools_use_id UNIQUE (job_id, tool_use_id),
  CONSTRAINT chk_subagent_tools_status CHECK (status IN ('pending','complete','failed'))
);
CREATE INDEX IF NOT EXISTS idx_subagent_tools_job ON subagent_tool_executions (job_id, status);

CREATE TABLE IF NOT EXISTS subagent_rate_leases (
  id            BIGSERIAL PRIMARY KEY,
  key           TEXT        NOT NULL,
  owner_job_id  BIGINT      NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_leases_key_expires ON subagent_rate_leases (key, expires_at);

-- ============================================================
-- Cycle coordination lock — v0.17 runCycle primitive
-- ============================================================
-- See src/schema.sql for full rationale. One row per active cycle.
-- PGLite is single-writer, so the lock doubly protects: the DB-level
-- row + the file lock at ~/.gbrain/cycle.lock prevent concurrent
-- CLI invocations from racing.
CREATE TABLE IF NOT EXISTS gbrain_cycle_locks (
  id              TEXT        PRIMARY KEY,
  holder_pid      INT         NOT NULL,
  holder_host     TEXT,
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cycle_locks_ttl ON gbrain_cycle_locks(ttl_expires_at);

-- ============================================================
-- Living Memory Intelligence Model — first-class DB surfaces
-- ============================================================
-- These tables persist the intelligence/memory objects that were previously
-- emitted only as artifact-local JSON: source items, evidence spans, episodes,
-- entities and mentions, claims + evidence/edges, memory atoms, scout runs and
-- observations, and surfacing candidates. All JSONB columns default to real
-- object/array values so downstream jsonb_typeof / GIN-style access keeps
-- working on both Postgres and PGLite.
CREATE TABLE IF NOT EXISTS source_items (
  id             BIGSERIAL PRIMARY KEY,
  source_id      TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  page_id        INTEGER     REFERENCES pages(id) ON DELETE SET NULL,
  namespace      TEXT        NOT NULL DEFAULT 'personal',
  privacy        TEXT        NOT NULL DEFAULT 'P2_PRIVATE',
  source_type    TEXT        NOT NULL,
  source_ref     TEXT        NOT NULL,
  title          TEXT        NOT NULL DEFAULT '',
  uri            TEXT,
  author         TEXT,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash   TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_items_identity_unique UNIQUE (source_id, source_type, source_ref),
  CONSTRAINT source_items_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_source_items_source_id ON source_items(source_id);
CREATE INDEX IF NOT EXISTS idx_source_items_page_id ON source_items(page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_items_captured_at ON source_items(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_items_namespace_privacy ON source_items(namespace, privacy);

CREATE TABLE IF NOT EXISTS evidence_spans (
  id                BIGSERIAL PRIMARY KEY,
  source_item_id    BIGINT      NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  page_id           INTEGER     REFERENCES pages(id) ON DELETE SET NULL,
  chunk_id          INTEGER     REFERENCES content_chunks(id) ON DELETE SET NULL,
  span_ref          TEXT        NOT NULL,
  span_kind         TEXT        NOT NULL DEFAULT 'quote',
  quote             TEXT        NOT NULL,
  normalized_text   TEXT        NOT NULL DEFAULT '',
  start_offset      INTEGER,
  end_offset        INTEGER,
  location          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT evidence_spans_ref_unique UNIQUE (source_item_id, span_ref),
  CONSTRAINT evidence_spans_offsets_valid CHECK (
    start_offset IS NULL OR end_offset IS NULL OR start_offset <= end_offset
  ),
  CONSTRAINT evidence_spans_location_object CHECK (jsonb_typeof(location) = 'object'),
  CONSTRAINT evidence_spans_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_evidence_spans_source_item ON evidence_spans(source_item_id);
CREATE INDEX IF NOT EXISTS idx_evidence_spans_page ON evidence_spans(page_id) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_spans_chunk ON evidence_spans(chunk_id) WHERE chunk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS episodes (
  id             BIGSERIAL PRIMARY KEY,
  source_id      TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  summary        TEXT        NOT NULL DEFAULT '',
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  salience       DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT episodes_time_order CHECK (started_at IS NULL OR ended_at IS NULL OR started_at <= ended_at),
  CONSTRAINT episodes_salience_range CHECK (salience >= 0 AND salience <= 1),
  CONSTRAINT episodes_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_episodes_source_time ON episodes(source_id, started_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_episodes_salience ON episodes(salience DESC);

CREATE TABLE IF NOT EXISTS entities (
  id              BIGSERIAL PRIMARY KEY,
  source_id       TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL,
  canonical_name  TEXT        NOT NULL,
  aliases         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entities_identity_unique UNIQUE (source_id, entity_type, canonical_name),
  CONSTRAINT entities_aliases_array CHECK (jsonb_typeof(aliases) = 'array'),
  CONSTRAINT entities_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_entities_source_type ON entities(source_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_canonical_name ON entities(canonical_name);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT      NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_item_id    BIGINT      REFERENCES source_items(id) ON DELETE CASCADE,
  evidence_span_id  BIGINT      REFERENCES evidence_spans(id) ON DELETE CASCADE,
  page_id           INTEGER     REFERENCES pages(id) ON DELETE SET NULL,
  surface_text      TEXT        NOT NULL,
  mention_type      TEXT        NOT NULL DEFAULT 'observed',
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_mentions_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT entity_mentions_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_span ON entity_mentions(evidence_span_id) WHERE evidence_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_mentions_source_item ON entity_mentions(source_item_id) WHERE source_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS claims (
  id             BIGSERIAL PRIMARY KEY,
  source_id      TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  statement      TEXT        NOT NULL,
  claim_type     TEXT        NOT NULL DEFAULT 'observation',
  status         TEXT        NOT NULL DEFAULT 'review_only',
  confidence     DOUBLE PRECISION NOT NULL DEFAULT 0,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claims_statement_unique UNIQUE (source_id, statement),
  CONSTRAINT claims_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT claims_time_order CHECK (first_seen_at <= last_seen_at),
  CONSTRAINT claims_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_claims_source_status ON claims(source_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_last_seen ON claims(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS claim_evidence (
  id                BIGSERIAL PRIMARY KEY,
  claim_id          BIGINT      NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_span_id  BIGINT      NOT NULL REFERENCES evidence_spans(id) ON DELETE CASCADE,
  source_item_id    BIGINT      REFERENCES source_items(id) ON DELETE CASCADE,
  stance            TEXT        NOT NULL DEFAULT 'supports',
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1,
  rationale         TEXT        NOT NULL DEFAULT '',
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claim_evidence_unique UNIQUE (claim_id, evidence_span_id, stance),
  CONSTRAINT claim_evidence_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT claim_evidence_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim ON claim_evidence(claim_id, stance);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_span ON claim_evidence(evidence_span_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_source_item ON claim_evidence(source_item_id) WHERE source_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS claim_edges (
  id             BIGSERIAL PRIMARY KEY,
  from_claim_id  BIGINT      NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  to_claim_id    BIGINT      NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  edge_type      TEXT        NOT NULL,
  confidence     DOUBLE PRECISION NOT NULL DEFAULT 1,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claim_edges_unique UNIQUE (from_claim_id, to_claim_id, edge_type),
  CONSTRAINT claim_edges_not_self CHECK (from_claim_id <> to_claim_id),
  CONSTRAINT claim_edges_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT claim_edges_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_claim_edges_from ON claim_edges(from_claim_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_claim_edges_to ON claim_edges(to_claim_id, edge_type);

CREATE TABLE IF NOT EXISTS memory_atoms (
  id                BIGSERIAL PRIMARY KEY,
  source_id         TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  atom_type         TEXT        NOT NULL,
  content           TEXT        NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0,
  salience          DOUBLE PRECISION NOT NULL DEFAULT 0,
  entity_id         BIGINT      REFERENCES entities(id) ON DELETE SET NULL,
  episode_id        BIGINT      REFERENCES episodes(id) ON DELETE SET NULL,
  claim_id          BIGINT      REFERENCES claims(id) ON DELETE SET NULL,
  source_item_id    BIGINT      REFERENCES source_items(id) ON DELETE SET NULL,
  evidence_span_id  BIGINT      REFERENCES evidence_spans(id) ON DELETE SET NULL,
  valid_at          TIMESTAMPTZ,
  obsolete_at       TIMESTAMPTZ,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_atoms_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT memory_atoms_salience_range CHECK (salience >= 0 AND salience <= 1),
  CONSTRAINT memory_atoms_time_order CHECK (valid_at IS NULL OR obsolete_at IS NULL OR valid_at <= obsolete_at),
  CONSTRAINT memory_atoms_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_memory_atoms_source_type ON memory_atoms(source_id, atom_type);
CREATE INDEX IF NOT EXISTS idx_memory_atoms_salience ON memory_atoms(salience DESC);
CREATE INDEX IF NOT EXISTS idx_memory_atoms_claim ON memory_atoms(claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_atoms_entity ON memory_atoms(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_atoms_episode ON memory_atoms(episode_id) WHERE episode_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scout_runs (
  id             BIGSERIAL PRIMARY KEY,
  source_id      TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  run_key        TEXT        NOT NULL,
  scout_type     TEXT        NOT NULL DEFAULT 'topic',
  status         TEXT        NOT NULL DEFAULT 'pending',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  query          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  summary        TEXT        NOT NULL DEFAULT '',
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scout_runs_key_unique UNIQUE (source_id, run_key),
  CONSTRAINT scout_runs_time_order CHECK (completed_at IS NULL OR started_at <= completed_at),
  CONSTRAINT scout_runs_query_object CHECK (jsonb_typeof(query) = 'object'),
  CONSTRAINT scout_runs_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_scout_runs_status ON scout_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_runs_source ON scout_runs(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scout_observations (
  id                BIGSERIAL PRIMARY KEY,
  scout_run_id      BIGINT      NOT NULL REFERENCES scout_runs(id) ON DELETE CASCADE,
  source_item_id    BIGINT      REFERENCES source_items(id) ON DELETE SET NULL,
  evidence_span_id  BIGINT      REFERENCES evidence_spans(id) ON DELETE SET NULL,
  observation_type  TEXT        NOT NULL DEFAULT 'signal',
  observation_text  TEXT        NOT NULL,
  score             DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scout_observations_score_range CHECK (score >= 0 AND score <= 1),
  CONSTRAINT scout_observations_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_scout_observations_run ON scout_observations(scout_run_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_scout_observations_span ON scout_observations(evidence_span_id) WHERE evidence_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scout_observations_source_item ON scout_observations(source_item_id) WHERE source_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS surfacing_candidates (
  id              BIGSERIAL PRIMARY KEY,
  source_id       TEXT        NOT NULL DEFAULT 'default' REFERENCES sources(id) ON DELETE CASCADE,
  memory_atom_id  BIGINT      REFERENCES memory_atoms(id) ON DELETE CASCADE,
  claim_id        BIGINT      REFERENCES claims(id) ON DELETE CASCADE,
  entity_id       BIGINT      REFERENCES entities(id) ON DELETE SET NULL,
  episode_id      BIGINT      REFERENCES episodes(id) ON DELETE SET NULL,
  source_item_id  BIGINT      REFERENCES source_items(id) ON DELETE SET NULL,
  candidate_type  TEXT        NOT NULL,
  reason          TEXT        NOT NULL DEFAULT '',
  score           DOUBLE PRECISION NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'pending',
  surfaced_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT surfacing_candidates_score_range CHECK (score >= 0 AND score <= 1),
  CONSTRAINT surfacing_candidates_time_order CHECK (surfaced_at IS NULL OR expires_at IS NULL OR surfaced_at <= expires_at),
  CONSTRAINT surfacing_candidates_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_surfacing_candidates_status ON surfacing_candidates(status, score DESC);
CREATE INDEX IF NOT EXISTS idx_surfacing_candidates_memory_atom ON surfacing_candidates(memory_atom_id) WHERE memory_atom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surfacing_candidates_claim ON surfacing_candidates(claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surfacing_candidates_source ON surfacing_candidates(source_id, created_at DESC);

-- ============================================================
-- Trigger-based search_vector (spans pages + timeline_entries)
-- ============================================================
ALTER TABLE pages ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_pages_search ON pages USING GIN(search_vector);

CREATE OR REPLACE FUNCTION update_page_search_vector() RETURNS trigger AS $$
DECLARE
  timeline_text TEXT;
BEGIN
  SELECT coalesce(string_agg(summary || ' ' || detail, ' '), '')
  INTO timeline_text
  FROM timeline_entries
  WHERE page_id = NEW.id;

  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.compiled_truth, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.timeline, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(timeline_text, '')), 'C');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pages_search_vector ON pages;
CREATE TRIGGER trg_pages_search_vector
  BEFORE INSERT OR UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION update_page_search_vector();

-- Note: timeline_entries trigger removed (v0.10.1).
-- Structured timeline_entries power temporal queries (graph layer).
-- pages.timeline (markdown) still feeds search_vector via trg_pages_search_vector.
DROP TRIGGER IF EXISTS trg_timeline_search_vector ON timeline_entries;
DROP FUNCTION IF EXISTS update_page_search_vector_from_timeline();
`;
