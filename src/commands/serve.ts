// ---------------------------------------------------------------------------
// Louvain community detection (pure JS, no native modules)
// Based on Blondel et al. "Fast unfolding of communities in large networks" (2008)
// ---------------------------------------------------------------------------
function louvainCommunities(
  nodeIds: string[],
  edges: { source: string; target: string; weight?: number }[]
): Map<string, number> {
  const index = new Map<string, number>();
  nodeIds.forEach((id, i) => index.set(id, i));

  const n = nodeIds.length;
  const m2 = edges.reduce((s, e) => s + (e.weight ?? 1), 0) * 2;

  const adj: [number, number][][] = Array.from({ length: n }, () => []);
  const k: number[] = Array(n).fill(0);

  for (const edge of edges) {
    const i = index.get(edge.source)!;
    const j = index.get(edge.target)!;
    const w = edge.weight ?? 1;
    if (i !== j) {
      adj[i] ??= [];
      adj[j] ??= [];
      adj[i].push([j, w]);
      adj[j].push([i, w]);
      k[i] += w;
      k[j] += w;
    }
  }

  let community = Int32Array.from({ length: n }, (_, i) => i);
  let communities = Int32Array.from({ length: n }, (_, i) => i);

  const communityNodes: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) communityNodes[i].push(i);

  const communityWeight = new Float64Array(n);
  for (let i = 0; i < n; i++) communityWeight[i] = k[i];

  let improved = true;
  let passes = 0;
  const maxPasses = 20;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;

    for (let i = 0; i < n; i++) {
      const orig = community[i];
      const bestGain = [0, orig] as [number, number];

      const neighbors = new Map<number, number>();
      adj[i] ??= [];
      for (const [j, w] of adj[i]) {
        neighbors.set(j, (neighbors.get(j) ?? 0) + w);
      }

      for (const [j, w] of neighbors) {
        const cj = communities[j];
        if (cj === orig) continue;
        const ki = k[i];
        const kj = communityWeight[cj];
        const delta_Q = w - (ki * kj) / m2;
        if (delta_Q > bestGain[0]) {
          bestGain[0] = delta_Q;
          bestGain[1] = cj;
        }
      }

      if (bestGain[1] !== orig) {
        improved = true;
        const newComm = bestGain[1];
        community[i] = newComm;
        communityNodes[orig] = communityNodes[orig].filter((x) => x !== i);
        communityNodes[newComm].push(i);
        communityWeight[orig] -= k[i];
        communityWeight[newComm] += k[i];
      }
    }

    const map = new Map<number, number>();
    let nc = 0;
    for (let i = 0; i < n; i++) {
      const c = community[i];
      if (!map.has(c)) map.set(c, nc++);
      communities[i] = map.get(c)!;
    }
    const newNodes: number[][] = Array.from({ length: nc }, () => []);
    for (let i = 0; i < n; i++) newNodes[communities[i]].push(i);
    communityWeight.fill(0);
    for (let i = 0; i < n; i++) communityWeight[communities[i]] += k[i];
  }

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) result.set(nodeIds[i], communities[i]);
  return result;
}

export async function runServe(engine: BrainEngine) {
  console.error('Starting GBrain MCP server (stdio)...');
  await startMcpServer(engine);
}

// ---------------------------------------------------------------------------
// Optional HTTP API server for GBrain Graph viewer integration.
// Runs alongside the MCP server when GBRAIN_HTTP_PORT is set.
// Usage: GBRAIN_HTTP_PORT=3001 gbrain serve
// ---------------------------------------------------------------------------
import type { BrainEngine } from '../core/engine.ts';
import { startMcpServer } from '../mcp/server.ts';
import { embed, getEmbeddingConfig } from '../core/embedding.ts';
import * as http from 'http';
import * as db from '../core/db.ts';

function buildGraphPayload(
  nodes: Array<{ slug: string; title: string; type: string; page_kind: string; compiled_truth: string; tags?: string[]; frontmatter?: Record<string, unknown> }>,
  edges: Array<{ from_slug: string; to_slug: string; link_type: string; context: string }>,
) {
  return {
    nodes: nodes.map((n) => ({
      slug: n.slug,
      title: n.title,
      type: n.type,
      pageKind: n.page_kind,
      compiledTruth: n.compiled_truth,
      tags: n.tags ?? [],
      frontmatter: n.frontmatter,
    })),
    edges: edges.map((e, idx) => ({
      id: `e-${e.from_slug}--${e.link_type || 'related'}--${e.to_slug}--${idx}`,
      source: e.from_slug,
      target: e.to_slug,
      linkType: e.link_type,
      context: e.context,
    })),
  };
}

export async function runHttpServer(engine: BrainEngine, port: number): Promise<void> {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local viewer (desktop Electron)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/api/graph/full') {
      try {
        const sql = db.getConnection();

        // Fetch all pages (nodes) — high limit to capture entire brain
        const pageRows = await sql`
          SELECT slug, title, type, page_kind, compiled_truth, frontmatter
          FROM pages
          ORDER BY slug
          LIMIT 100000
        `;

        // Fetch all links (edges)
        const linkRows = await sql`
          SELECT f.slug as from_slug, t.slug as to_slug, l.link_type, l.context
          FROM links l
          JOIN pages f ON f.id = l.from_page_id
          JOIN pages t ON t.id = l.to_page_id
          LIMIT 100000
        `;

        const payload = buildGraphPayload(
          pageRows as any,
          linkRows as any,
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch (err) {
        console.error('[/api/graph/full] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // --- Semantic Search ---
    if (url.pathname === '/api/search/semantic') {
      const queryStr = url.searchParams.get('query') ?? '';
      const limitStr = url.searchParams.get('limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 20;

      // Read body for POST requests
      let body = '';
      if (req.method === 'POST' || req.method === 'GET') {
        for await (const chunk of req) body += chunk;
      }

      let query = queryStr;
      let bodyLimit = limit;

      if (body) {
        try {
          const parsed = JSON.parse(body);
          query = parsed.query ?? query;
          bodyLimit = parsed.limit ?? bodyLimit;
        } catch {
          // ignore malformed body
        }
      }

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'query is required' }));
        return;
      }

      try {
        const { backend } = getEmbeddingConfig();
        if (backend === 'none') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'semantic search unavailable — no embedding backend configured' }));
          return;
        }

        const embedding = await embed(query);
        const vecStr = '[' + Array.from(embedding).join(',') + ']';
        const sql = db.getConnection();

        // Search content_chunks by cosine distance, join to pages for slug/title
        const rows = await sql`
          WITH top_chunks AS (
            SELECT
              cc.page_id,
              cc.chunk_text,
              1 - (cc.embedding <=> ${vecStr}::vector) AS score
            FROM content_chunks cc
            WHERE cc.embedding IS NOT NULL
            ORDER BY cc.embedding <=> ${vecStr}::vector
            LIMIT ${bodyLimit}
          )
          SELECT
            p.slug,
            p.title,
            tc.score
          FROM top_chunks tc
          JOIN pages p ON p.id = tc.page_id
          ORDER BY tc.score DESC
        `;

        const results = ((rows as unknown) as Array<{ slug: string; title: string; score: number }>).map(r => ({
          slug: r.slug,
          title: r.title,
          score: Math.round(r.score * 1000) / 1000,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (err: unknown) {
        console.error('[/api/search/semantic] Error:', err);
        // Detect dimension mismatch between embedding backend and stored vectors
        if (
          err && typeof err === 'object' &&
          'code' in err && String(err['code']) === '22000'
        ) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'semantic search unavailable — embedding dimension mismatch (backend model produces different dimensions than stored vectors)',
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'semantic search unavailable' }));
        }
      }
      return;
    }

    if (url.pathname === '/api/graph/cluster') {
      let body = '';
      for await (const chunk of req) body += chunk;

      let input: { algorithm?: string; nodes?: { id: string; embedding?: number[] }[] } = {};
      try { input = JSON.parse(body); } catch { /* ignore */ }

      if (!input.nodes || !Array.isArray(input.nodes)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'nodes array is required' }));
        return;
      }

      try {
        const sql = db.getConnection();

        // Ensure cluster_id column exists on pages table
        await sql.unsafe(`
          ALTER TABLE pages ADD COLUMN IF NOT EXISTS cluster_id INTEGER DEFAULT NULL
        `);

        if (input.algorithm === 'louvain') {
          // Build edge list from DB
          const linkRows = await sql`
            SELECT f.slug as source, t.slug as target, 1 as weight
            FROM links l
            JOIN pages f ON f.id = l.from_page_id
            JOIN pages t ON t.id = l.to_page_id
          `;

          const edges = ((linkRows as unknown) as { source: string; target: string; weight: number }[]).map(r => ({
            source: r.source,
            target: r.target,
            weight: r.weight ?? 1,
          }));

          const nodeIds = input.nodes.map(n => n.id);
          const communityMap = louvainCommunities(nodeIds, edges);

          const results: { node_id: string; cluster_id: number }[] = [];
          for (const node of input.nodes) {
            const clusterId = communityMap.get(node.id) ?? 0;
            await sql`UPDATE pages SET cluster_id = ${clusterId} WHERE slug = ${node.id}`;
            results.push({ node_id: node.id, cluster_id: clusterId });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unsupported algorithm — only "louvain" is supported' }));
        }
      } catch (err) {
        console.error('[/api/graph/cluster] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.error(`GBrain HTTP API listening on http://localhost:${port}`);
      console.error(`  GET /api/graph/full  — full graph`);
      console.error(`  GET /api/health      — health check`);
      resolve();
    });
  });
}
