#!/usr/bin/env bun
/**
 * write-enriched-bookmarks.mjs
 * Reads enriched X bookmarks and writes them as GBrain pages via CLI.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ENRICHED_DIR = '/Users/a/.gbrain/integrations/enriched/x/';
const GBRAIN_CLI   = '/Users/a/.openclaw/workspace/gbrain/src/cli.ts';
const LIMIT        = 350; // no cap — process all enriched bookmarks
let written = 0;
let errors  = 0;

const files = readdirSync(ENRICHED_DIR).filter(f => f.endsWith('.json')).slice(0, LIMIT);

for (const file of files) {
  const raw = readFileSync(join(ENRICHED_DIR, file), 'utf8');
  let d;
  try { d = JSON.parse(raw); } catch { continue; }

  const permalink  = d['permalink'] || '';
  const author     = permalink.includes('x.com/') 
    ? permalink.split('x.com/')[1].split('/')[0] 
    : 'unknown';
  const id         = (d['id'] || file).replace('x:', '');
  const slug        = `sources/bookmarks/x/${author}/${id}`;
  const full_text   = d['full_text'] || '';
  const platform    = d['platform'] || 'x';
  const created_at  = d['created_at'] || new Date().toISOString();

  const content = `---
type: bookmark
platform: ${platform}
source_id: ${d['id'] || ''}
permalink: ${permalink}
created_at: ${created_at}
tags: [bookmark, x, ${author}]
---

# ${author} / ${id.slice(0, 12)}

${full_text}
`;

  const result = spawnSync(
    'bun',
    ['run', GBRAIN_CLI, 'put', slug, '--content', content],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );

  if (result.status === 0) {
    console.log(`✓ ${slug}`);
    written++;
  } else {
    console.error(`✗ ${slug}: ${result.stderr?.slice(0, 200)}`);
    errors++;
  }
}

console.log(`\nDone. Wrote ${written} pages, ${errors} errors.`);