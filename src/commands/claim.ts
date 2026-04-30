import { readFileSync } from 'node:fs';
import { loadConfig, toEngineConfig } from '../core/config.ts';
import type { BrainEngine } from '../core/engine.ts';
import {
  buildClaimLedgerRecord,
  enqueueClaimLedgerRecord,
  evidenceRefFromSpan,
  listClaimLedgerRecords,
  showClaimLedgerRecord,
  validateClaimLedgerRecord,
  verifyClaimLedgerRecord,
  type ClaimEdge,
  type ClaimStatus,
  type ClaimType,
} from '../core/claims/claim-ledger.ts';
import type { GBrainNamespace, GBrainPrivacy, GBrainSensitivity } from '../core/memory/namespace-policy.ts';
import { buildSourceDocument, parseSpanId, showLines } from '../core/evidence/source-window.ts';

interface PageRow {
  slug: string;
  source_id?: string | null;
  title?: string | null;
  compiled_truth?: string | null;
  timeline?: string | null;
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function loadJson(path?: string): unknown {
  if (!path) {
    console.error('Missing required --record <record.json>');
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read claim record: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseEdges(args: string[]): ClaimEdge[] | undefined {
  const raw = flagValue(args, '--edge');
  if (!raw) return undefined;
  const edges = raw.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const [type, claim_id] = part.split(':');
    return { type, claim_id } as ClaimEdge;
  });
  return edges.length ? edges : undefined;
}

async function connectEngineForClaimHydration(): Promise<BrainEngine> {
  const config = loadConfig();
  if (!config) throw new Error('No brain configured. Run: gbrain init, or pass --quote explicitly.');
  const { createEngine } = await import('../core/engine-factory.ts');
  const engine = await createEngine(toEngineConfig(config));
  const noRetry = process.argv.includes('--no-retry-connect') || process.env.GBRAIN_NO_RETRY_CONNECT === '1';
  const { connectWithRetry } = await import('../core/db.ts');
  await connectWithRetry(engine, toEngineConfig(config), { noRetry });
  return engine;
}

export async function hydrateEvidenceFromSpan(engine: Pick<BrainEngine, 'executeRaw'>, spanId: string, expectedQuoteHash?: string) {
  const span = parseSpanId(spanId);
  const rows = await engine.executeRaw<PageRow>(
    `SELECT p.slug, p.source_id, p.title, p.compiled_truth, p.timeline
       FROM pages p
      WHERE p.slug = $1 AND p.source_id = $2
      LIMIT 1`,
    [span.slug, span.sourceId],
  );
  if (rows.length === 0) throw new Error(`Could not resolve source span: source page not found: ${span.sourceId}:${span.slug}`);

  const doc = buildSourceDocument(rows[0]);
  const window = showLines(doc, span.section, span.startLine, span.endLine);
  if (window.spanId !== spanId) {
    throw new Error(`Could not resolve source span exactly: requested ${spanId}, resolved ${window.spanId}`);
  }
  if (expectedQuoteHash && expectedQuoteHash !== window.quoteHash) {
    throw new Error(`Source span quote hash mismatch: expected ${expectedQuoteHash}, got ${window.quoteHash}`);
  }
  return evidenceRefFromSpan(spanId, window.quote, window.quoteHash);
}

export async function runClaimCommand(args: string[], hydrationEngine?: Pick<BrainEngine, 'executeRaw'>): Promise<void> {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }
  const subArgs = args.slice(1);

  if (sub === 'validate') {
    const record = loadJson(flagValue(subArgs, '--record'));
    const errors = validateClaimLedgerRecord(record);
    const result = { ok: errors.length === 0, action: 'validate', errors };
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (errors.length === 0) console.log('Claim ledger record valid.');
    else console.error(`Claim ledger record invalid:\n- ${errors.join('\n- ')}`);
    if (errors.length > 0) process.exit(1);
    return;
  }

  if (sub === 'propose') {
    const spanId = flagValue(subArgs, '--from-span');
    const claim = flagValue(subArgs, '--claim');
    const quote = flagValue(subArgs, '--quote');
    if (!spanId || !claim) {
      console.error('Usage: gbrain claims propose --from-span <gbs1:...> --claim "..." [--quote "..."] [--type world_claim] [--namespace personal] [--privacy private] [--sensitivity high] [--confidence 0.7] [--yes] [--json]');
      process.exit(1);
    }
    let ownedEngine: BrainEngine | undefined;
    let record;
    try {
      let evidence;
      if (quote) {
        evidence = evidenceRefFromSpan(spanId, quote, flagValue(subArgs, '--quote-hash'));
      } else {
        ownedEngine = hydrationEngine ? undefined : await connectEngineForClaimHydration();
        evidence = await hydrateEvidenceFromSpan(hydrationEngine || ownedEngine!, spanId, flagValue(subArgs, '--quote-hash'));
      }
      record = buildClaimLedgerRecord({
        claim,
        type: (flagValue(subArgs, '--type') || 'other') as ClaimType,
        status: (flagValue(subArgs, '--status') || 'proposed') as ClaimStatus,
        namespace: flagValue(subArgs, '--namespace') as GBrainNamespace | undefined,
        privacy: flagValue(subArgs, '--privacy') as GBrainPrivacy | undefined,
        sensitivity: flagValue(subArgs, '--sensitivity') as GBrainSensitivity | undefined,
        confidence: Number(flagValue(subArgs, '--confidence') || 0.5),
        observedAt: flagValue(subArgs, '--observed-at'),
        validFrom: flagValue(subArgs, '--valid-from'),
        validTo: flagValue(subArgs, '--valid-to'),
        evidence: [evidence],
        edges: parseEdges(subArgs),
      });
    } catch (err) {
      console.error(`Failed to build claim proposal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      if (ownedEngine) await ownedEngine.disconnect();
    }
    const dryRun = hasFlag(subArgs, '--dry-run') || !hasFlag(subArgs, '--yes');
    const result = enqueueClaimLedgerRecord(record, { dryRun });
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (!result.ok) console.error(`Claim proposal invalid:\n- ${(result.errors || []).join('\n- ')}`);
    else if (result.duplicate) console.log(`Claim proposal already queued: ${record.id}`);
    else if (dryRun) console.log(`Dry run: claim proposal would append to ${result.ledgerPath}`);
    else console.log(`Queued claim proposal: ${record.id}`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'list') {
    const result = listClaimLedgerRecords({ tables: hasFlag(subArgs, '--tables') });
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (!result.records?.length) console.log(`No claim ledger records found at ${result.ledgerPath}`);
    else console.log(result.records.map(r => `${r.id}\t${r.status}\t${r.namespace}/${r.privacy}/${r.sensitivity}\t${r.type}\t${r.confidence}\t${r.claim}`).join('\n'));
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'verify') {
    const id = subArgs[0] || flagValue(subArgs, '--id');
    if (!id) {
      console.error('Usage: gbrain claims verify <claim_id> [--json]');
      process.exit(1);
    }
    const result = verifyClaimLedgerRecord(id);
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (result.ok) console.log(`Claim can be verified after review: ${id}`);
    else console.error(`Claim cannot be verified:\n- ${(result.errors || []).join('\n- ')}`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'show') {
    const id = subArgs[0] || flagValue(subArgs, '--id');
    if (!id) {
      console.error('Usage: gbrain claims show <claim_id> [--json]');
      process.exit(1);
    }
    const result = showClaimLedgerRecord(id);
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (result.record) {
      console.log(`${result.record.id} [${result.record.status}, ${result.record.type}, ${result.record.namespace}/${result.record.privacy}/${result.record.sensitivity}, confidence=${result.record.confidence}]`);
      console.log(result.record.claim);
      for (const ev of result.record.evidence) {
        console.log(`- ${ev.span_id}`);
        console.log(`  quote_hash: ${ev.quote_hash}`);
        console.log(`  quote: ${ev.quote.replace(/\s+/g, ' ').slice(0, 240)}`);
      }
    } else console.error((result.errors || []).join('\n'));
    if (!result.ok) process.exit(1);
    return;
  }

  console.error(`Unknown claim subcommand: ${sub}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`gbrain claims propose --from-span <gbs1:...> --claim "..." [--quote "..."] [--type world_claim] [--namespace personal] [--privacy private] [--sensitivity high] [--confidence 0.7] [--yes] [--json]
gbrain claims verify <claim_id> [--json]
gbrain claims validate --record <record.json> [--json]
gbrain claims list [--json] [--tables]
gbrain claims show <claim_id> [--json]

Minimal review-only claim ledger. If --quote is omitted, propose hydrates it from the exact gbs1 source span. No trusted pages are edited; proposed claims must cite exact source_span refs plus quote hashes. Namespace/privacy/sensitivity default conservatively to personal/private/high.`);
}
