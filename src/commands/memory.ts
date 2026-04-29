import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join } from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { configDir } from '../core/config.ts';
import { routeTypedMemory } from '../core/memory/typed-memory-router.ts';
import { loadContextPackV2, type GBrainContextPackMode } from '../core/memory/context-pack.ts';
import { GBRAIN_NAMESPACES, GBRAIN_PRIVACY_LEVELS, GBRAIN_SENSITIVITY_LEVELS, type GBrainNamespace, type GBrainPrivacy, type GBrainSensitivity } from '../core/memory/namespace-policy.ts';
import { buildRadarReport, scoreRadarCandidates } from '../core/memory/radar.ts';
import { reduceReviewJsonlToProposalPacket } from '../core/memory/reducer-bridge.ts';
import { loadScoutInputs, runScoutDryRun, validateScoutObservation, validateScoutRecipe, type ScoutObservation } from '../core/memory/scoutnet.ts';

export type MemoryProposalCommandResult = {
  ok: boolean;
  action: 'validate' | 'enqueue' | 'list' | 'export' | 'reduce' | 'route' | 'surface' | 'context-pack' | 'scout-validate' | 'scout-dry-run' | 'radar-score' | 'radar-list';
  dryRun?: boolean;
  queued?: boolean;
  duplicate?: boolean;
  proposal?: MemoryProposalRecord;
  proposals?: MemoryProposalRecord[];
  count?: number;
  queueExists?: boolean;
  errors?: string[];
  queuePath?: string;
  format?: 'markdown';
  content?: string;
  outputPath?: string;
  written?: boolean;
};

export type MemoryProposalRecord = {
  id: string;
  created_at: string;
  status: 'pending_review';
  packet_type: 'governed_surfacing_proposal_packet';
  schema_version: number;
  context_hash: string;
  outcome: string;
  review_required: true;
  candidate_count: number;
  packet: any;
  guardrails: {
    trusted_pages_edited: false;
    external_messages_sent: false;
    global_config_changed: false;
    packet_is_review_only: true;
  };
};

const QUEUE_FILE = 'memory-proposals.jsonl';
const require = createRequire(import.meta.url);

function workspaceRoot(): string {
  const cwd = process.cwd();
  const generatorRel = 'ops/gbrain-memory-engine/generate-surfacing-proposal-packet.js';
  if (existsSync(join(cwd, generatorRel))) return cwd;
  if (existsSync(join(dirname(cwd), generatorRel))) return dirname(cwd);
  if (cwd.endsWith('/gbrain')) return dirname(cwd);
  return cwd;
}

function loadSurfacingProposalGenerator(): (args: Record<string, any>) => any {
  const generatorPath = join(workspaceRoot(), 'ops/gbrain-memory-engine/generate-surfacing-proposal-packet.js');
  const mod = require(generatorPath);
  if (typeof mod.generatePacket !== 'function') throw new Error(`generatePacket export not found at ${generatorPath}`);
  return mod.generatePacket;
}

export function memoryProposalQueuePath(): string {
  return join(configDir(), QUEUE_FILE);
}

function ensureParent(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function safeSourceLabel(pathValue: unknown): string {
  const raw = String(pathValue || '').trim();
  if (!raw) return 'unknown';
  const normalized = raw.replace(/\\/g, '/');
  const label = basename(normalized) || normalized.split('/').filter(Boolean).pop() || 'source';
  return isAbsolute(raw) || normalized.includes('/') ? label : raw;
}

function safeQuote(quote: unknown, maxChars = 240): string | undefined {
  if (typeof quote !== 'string' || quote.length === 0) return undefined;
  const oneLine = quote.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function safeRouteResult(result: ReturnType<typeof routeTypedMemory>): Record<string, any> {
  return {
    generated_at: result.generated_at,
    query: result.query,
    context: result.context,
    matched_routes: result.matched_routes,
    desired_memory_types: result.desired_memory_types,
    desired_entities: result.desired_entities,
    results: result.results.map(r => ({
      id: r.id,
      memory_type: r.memory_type,
      title: r.title,
      claim: r.claim,
      score: r.score,
      reasons: r.reasons,
      sensitivity: r.sensitivity,
      permission_scope: r.permission_scope,
      surfacing_policy: r.surfacing_policy,
      entities: r.entities,
      status: r.status,
      source: {
        kind: r.source?.kind,
        label: safeSourceLabel(r.source?.path),
        quote: safeQuote(r.source?.quote),
        timestamp: r.source?.timestamp,
        parent_ids: r.source?.parent_ids,
      },
    })),
    pass: result.pass,
    warnings: result.warnings.map(w => String(w).replace(/\/Users\/[^\s:]+/g, '$HOME').replace(process.env.HOME || '\0', '$HOME')),
  };
}

export function validateSurfacingProposalPacket(packet: unknown): string[] {
  const errors: string[] = [];
  const p = asObject(packet);
  if (!p) return ['packet must be a JSON object'];

  if (p.packet_type !== 'governed_surfacing_proposal_packet') errors.push('packet_type must be governed_surfacing_proposal_packet');
  if (p.schema_version !== 1) errors.push('schema_version must be 1');

  const validation = asObject(p.validation);
  if (!validation || validation.pass !== true) errors.push('validation.pass must be true');

  const guardrails = asObject(p.guardrails);
  if (!guardrails) {
    errors.push('guardrails must be present');
  } else {
    if (guardrails.packet_is_review_only !== true) errors.push('guardrails.packet_is_review_only must be true');
    if (guardrails.trusted_pages_edited !== false) errors.push('guardrails.trusted_pages_edited must be false');
    if (guardrails.external_messages_sent !== false) errors.push('guardrails.external_messages_sent must be false');
    if (guardrails.global_config_changed !== false) errors.push('guardrails.global_config_changed must be false');
  }

  if (p.review_required !== true) errors.push('review_required must be true');

  const context = asObject(p.context);
  if (!context || typeof context.hash !== 'string' || context.hash.length === 0) errors.push('context.hash is required');

  if (!Array.isArray(p.candidates)) {
    errors.push('candidates must be an array');
  } else if (p.candidates.length === 0) {
    errors.push('candidates must include at least one proposal candidate');
  } else {
    p.candidates.forEach((candidate: unknown, idx: number) => {
      const c = asObject(candidate);
      const prefix = `candidates[${idx}]`;
      if (!c) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (typeof c.id !== 'string' || c.id.length === 0) errors.push(`${prefix}.id is required`);
      const source = asObject(c.source);
      if (!source || typeof source.path !== 'string' || source.path.length === 0) errors.push(`${prefix}.source.path is required`);
      if (!source || typeof source.quote !== 'string' || source.quote.length === 0) errors.push(`${prefix}.source.quote is required`);
      const forbidden = Array.isArray(c.forbidden_actions) ? c.forbidden_actions : [];
      if (!forbidden.includes('trusted_brain_direct_edit')) errors.push(`${prefix}.forbidden_actions must include trusted_brain_direct_edit`);
      if (!forbidden.includes('external_message_send')) errors.push(`${prefix}.forbidden_actions must include external_message_send`);
      if (!forbidden.includes('auto_accept_high_sensitivity_memory')) errors.push(`${prefix}.forbidden_actions must include auto_accept_high_sensitivity_memory`);
      if (c.sensitivity === 'high' && p.review_required !== true) errors.push(`${prefix} high-sensitivity candidate requires review_required=true`);
    });
  }

  return errors;
}

export function proposalDedupeKey(packet: any): string {
  const candidateIds = Array.isArray(packet?.candidates) ? packet.candidates.map((c: any) => c?.id).filter(Boolean).sort() : [];
  return `${packet?.context?.hash || ''}:${candidateIds.join(',')}`;
}

export function proposalIdForPacket(packet: any, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const hash = createHash('sha256').update(proposalDedupeKey(packet)).digest('hex').slice(0, 10);
  return `memprop_${stamp}_${hash}`;
}

export function buildMemoryProposalRecord(packet: any, now = new Date()): MemoryProposalRecord {
  return {
    id: proposalIdForPacket(packet, now),
    created_at: now.toISOString(),
    status: 'pending_review',
    packet_type: 'governed_surfacing_proposal_packet',
    schema_version: packet.schema_version,
    context_hash: packet.context.hash,
    outcome: packet.outcome || 'unknown',
    review_required: true,
    candidate_count: Array.isArray(packet.candidates) ? packet.candidates.length : 0,
    packet,
    guardrails: {
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      packet_is_review_only: true,
    },
  };
}

export function queueContainsProposal(queuePath: string, packet: any): boolean {
  if (!existsSync(queuePath)) return false;
  const key = proposalDedupeKey(packet);
  const content = readFileSync(queuePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.packet && proposalDedupeKey(record.packet) === key) return true;
      if (record?.context_hash === packet?.context?.hash) {
        const ids = Array.isArray(record?.packet?.candidates) ? record.packet.candidates.map((c: any) => c?.id).filter(Boolean).sort().join(',') : '';
        const candidateIds = Array.isArray(packet?.candidates) ? packet.candidates.map((c: any) => c?.id).filter(Boolean).sort().join(',') : '';
        if (ids === candidateIds) return true;
      }
    } catch {
      // Ignore malformed historical queue lines; validation is for new writes.
    }
  }
  return false;
}

export function enqueueMemoryProposalPacket(packet: any, opts: { dryRun?: boolean; queuePath?: string; now?: Date } = {}): MemoryProposalCommandResult {
  const errors = validateSurfacingProposalPacket(packet);
  const queuePath = opts.queuePath || memoryProposalQueuePath();
  if (errors.length > 0) return { ok: false, action: 'enqueue', dryRun: !!opts.dryRun, errors, queuePath };

  const duplicate = queueContainsProposal(queuePath, packet);
  const proposal = buildMemoryProposalRecord(packet, opts.now || new Date());
  if (duplicate) return { ok: true, action: 'enqueue', dryRun: !!opts.dryRun, queued: false, duplicate: true, proposal, queuePath };
  if (!opts.dryRun) {
    ensureParent(queuePath);
    appendFileSync(queuePath, JSON.stringify(proposal) + '\n', 'utf-8');
  }
  return { ok: true, action: 'enqueue', dryRun: !!opts.dryRun, queued: !opts.dryRun, duplicate: false, proposal, queuePath };
}

export function listMemoryProposalPackets(opts: { queuePath?: string } = {}): MemoryProposalCommandResult {
  const queuePath = opts.queuePath || memoryProposalQueuePath();
  if (!existsSync(queuePath)) {
    return { ok: true, action: 'list', proposals: [], count: 0, queueExists: false, queuePath };
  }

  const proposals: MemoryProposalRecord[] = [];
  const errors: string[] = [];
  const content = readFileSync(queuePath, 'utf-8');
  content.split('\n').forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      proposals.push(JSON.parse(line));
    } catch (err) {
      errors.push(`line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return {
    ok: errors.length === 0,
    action: 'list',
    proposals,
    count: proposals.length,
    queueExists: true,
    errors: errors.length > 0 ? errors : undefined,
    queuePath,
  };
}

function candidateSummary(candidate: any): string {
  const source = asObject(candidate?.source) || {};
  const pieces = [
    `- ${candidate?.id || '(missing id)'}`,
    `  - action: ${candidate?.proposed_action || '(unspecified)'}`,
    `  - memory_type: ${candidate?.memory_type || '(unspecified)'}`,
    `  - sensitivity: ${candidate?.sensitivity || '(unspecified)'}`,
    `  - source: ${safeSourceLabel(source.path)}`,
  ];
  if (source.quote) pieces.push(`  - quote: ${safeQuote(source.quote)}`);
  if (candidate?.claim) pieces.push(`  - claim: ${String(candidate.claim).replace(/\n/g, ' ')}`);
  return pieces.join('\n');
}

export function exportMemoryProposalPackets(opts: { queuePath?: string; format?: 'markdown' } = {}): MemoryProposalCommandResult {
  const listed = listMemoryProposalPackets({ queuePath: opts.queuePath });
  const format = opts.format || 'markdown';
  if (!listed.ok) return { ...listed, action: 'export', format };

  const lines: string[] = [
    '# GBrain memory proposals review export',
    '',
    `Queue: ${listed.queuePath}`,
    `Count: ${listed.count || 0}`,
    '',
    '> Review-only export. This command does not edit trusted brain pages or send external messages.',
    '',
  ];

  for (const proposal of listed.proposals || []) {
    lines.push(`## ${proposal.id}`);
    lines.push('');
    lines.push(`- status: ${proposal.status}`);
    lines.push(`- created_at: ${proposal.created_at}`);
    lines.push(`- context_hash: ${proposal.context_hash}`);
    lines.push(`- outcome: ${proposal.outcome}`);
    lines.push(`- candidate_count: ${proposal.candidate_count}`);
    lines.push(`- guardrails: trusted_pages_edited=${proposal.guardrails?.trusted_pages_edited}, external_messages_sent=${proposal.guardrails?.external_messages_sent}, global_config_changed=${proposal.guardrails?.global_config_changed}, review_only=${proposal.guardrails?.packet_is_review_only}`);
    lines.push('');
    lines.push('### Candidates');
    lines.push('');
    const candidates = Array.isArray(proposal.packet?.candidates) ? proposal.packet.candidates : [];
    if (candidates.length === 0) lines.push('- (none)');
    else candidates.forEach((candidate: any) => lines.push(candidateSummary(candidate)));
    lines.push('');
  }

  return { ...listed, action: 'export', format, content: lines.join('\n') };
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printJson(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}

function csvFlag(args: string[], name: string): string[] {
  return (flagValue(args, name) || '').split(',').map(s => s.trim()).filter(Boolean);
}

function parseContextPackMode(value: string): GBrainContextPackMode {
  if (value === 'daily' || value === 'meeting' || value === 'decision' || value === 'project') return value;
  console.error('Invalid --mode. Expected one of: daily, meeting, decision, project');
  process.exit(1);
}

function parseAllowedNamespaces(values: string[]): GBrainNamespace[] | undefined {
  if (values.length === 0) return undefined;
  const bad = values.filter(v => !(GBRAIN_NAMESPACES as readonly string[]).includes(v));
  if (bad.length) {
    console.error(`Invalid --allowed-namespaces value(s): ${bad.join(', ')}`);
    process.exit(1);
  }
  return values as GBrainNamespace[];
}

function parsePrivacy(value: string): GBrainPrivacy {
  if ((GBRAIN_PRIVACY_LEVELS as readonly string[]).includes(value)) return value as GBrainPrivacy;
  console.error(`Invalid --max-privacy. Expected one of: ${GBRAIN_PRIVACY_LEVELS.join(', ')}`);
  process.exit(1);
}

function parseSensitivity(value: string): GBrainSensitivity {
  if ((GBRAIN_SENSITIVITY_LEVELS as readonly string[]).includes(value)) return value as GBrainSensitivity;
  console.error(`Invalid --max-sensitivity. Expected one of: ${GBRAIN_SENSITIVITY_LEVELS.join(', ')}`);
  process.exit(1);
}

function loadPacketFromArgs(args: string[]): any {
  const packetPath = flagValue(args, '--packet');
  if (!packetPath) {
    console.error('Missing required --packet <packet.json>');
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(packetPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read packet: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function loadScoutObservationsForRadar(inputPath: string): ScoutObservation[] {
  const parsed = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.observations) ? parsed.observations : Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return values as ScoutObservation[];
}

export async function runMemory(args: string[]): Promise<void> {
  const group = args[0];
  const sub = args[1];
  if (!group || group === '--help' || group === '-h') {
    printHelp();
    return;
  }

  if (group === 'route') {
    const subArgs = args.slice(1);
    const query = flagValue(subArgs, '--query') || '';
    const contextFile = flagValue(subArgs, '--context-file');
    let context = flagValue(subArgs, '--context') || '';
    if (contextFile) {
      try {
        context = readFileSync(contextFile, 'utf-8');
      } catch (err) {
        console.error(`Failed to read context file: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    const limit = Number(flagValue(subArgs, '--limit') || 8);
    const result = routeTypedMemory({ query, context, limit, includeHigh: hasFlag(subArgs, '--include-high') });
    if (hasFlag(subArgs, '--json')) printJson({ ok: true, action: 'route', ...safeRouteResult(result) });
    else printRouteHuman(result);
    if (!result.pass) process.exit(1);
    return;
  }


  if (group === 'context-pack') {
    const subArgs = args.slice(1);
    const mode = parseContextPackMode(flagValue(subArgs, '--mode') || 'project');
    const topic = flagValue(subArgs, '--query') || flagValue(subArgs, '--topic') || '';
    const pack = loadContextPackV2({
      mode,
      topic,
      ledgerPath: flagValue(subArgs, '--ledger'),
      allowedNamespaces: parseAllowedNamespaces(csvFlag(subArgs, '--allowed-namespaces')),
      maxPrivacy: parsePrivacy(flagValue(subArgs, '--max-privacy') || 'internal'),
      maxSensitivity: parseSensitivity(flagValue(subArgs, '--max-sensitivity') || 'medium'),
      limit: Number(flagValue(subArgs, '--limit') || 8),
    });
    if (hasFlag(subArgs, '--json')) printJson({ ok: pack.status === 'hit', action: 'context-pack', ...pack });
    else if (hasFlag(subArgs, '--compact')) printContextPackCompactHuman(pack);
    else printContextPackHuman(pack);
    if (pack.status !== 'hit') process.exit(1);
    return;
  }

  if (group === 'surface') {
    const subArgs = args.slice(1);
    if (hasFlag(subArgs, '--write')) {
      console.error('gbrain memory surface is review-only and never edits trusted pages, sends external messages, or changes global config. Use --enqueue --yes only to append to the review queue.');
      process.exit(1);
    }
    try {
      const generatePacket = loadSurfacingProposalGenerator();
      const packet = generatePacket({
        query: flagValue(subArgs, '--query') || flagValue(subArgs, '-q') || '',
        context: flagValue(subArgs, '--context') || flagValue(subArgs, '-c') || '',
        contextFile: flagValue(subArgs, '--context-file') || '',
        contextMode: flagValue(subArgs, '--context-mode') || 'latest-status-entry',
        statusTailLines: Number(flagValue(subArgs, '--status-tail-lines') || 80),
        limit: Number(flagValue(subArgs, '--limit') || 8),
        includeBookmarkCandidates: hasFlag(subArgs, '--include-bookmark-candidates'),
        bookmarkReductionFile: flagValue(subArgs, '--bookmark-reduction-file') || '',
        bookmarkInputDir: flagValue(subArgs, '--bookmark-input-dir') || join(process.env.HOME || '', '.gbrain/integrations/enriched/x'),
        bookmarkLimitEvidence: Number(flagValue(subArgs, '--bookmark-limit-evidence') || 6),
        json: hasFlag(subArgs, '--json'),
        write: false,
        out: '',
      });

      const shouldEnqueue = hasFlag(subArgs, '--enqueue');
      const dryRun = shouldEnqueue && (hasFlag(subArgs, '--dry-run') || !hasFlag(subArgs, '--yes'));
      const enqueueResult = shouldEnqueue ? enqueueMemoryProposalPacket(packet, { dryRun }) : undefined;
      const ok = shouldEnqueue ? enqueueResult?.ok === true : packet?.validation?.pass === true;

      if (hasFlag(subArgs, '--json')) printJson({ ok, action: 'surface', dryRun: shouldEnqueue ? dryRun : undefined, packet, enqueue: enqueueResult });
      else {
        printSurfacingPacketHuman(packet);
        if (shouldEnqueue) {
          if (!enqueueResult?.ok) console.error(`Memory surface packet invalid for enqueue:\n- ${(enqueueResult?.errors || []).join('\n- ')}`);
          else if (enqueueResult.duplicate) console.log(`Memory proposal already queued: ${enqueueResult.proposal?.id}`);
          else if (dryRun) console.log(`Dry run: memory proposal packet would enqueue to ${enqueueResult.queuePath}`);
          else console.log(`Queued memory proposal: ${enqueueResult.proposal?.id}`);
        }
      }
      if (!ok) process.exit(1);
    } catch (err) {
      console.error(`Failed to generate review-only surfacing proposal packet: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (group === 'scout') {
    const action = args[1];
    const subArgs = args.slice(2);
    if (!action || action === '--help' || action === '-h') {
      printHelp();
      return;
    }
    const recipePath = flagValue(subArgs, '--recipe');
    if (!recipePath) {
      console.error('Missing required --recipe <recipe.json>');
      process.exit(1);
    }
    const observationsPath = flagValue(subArgs, '--observations') || flagValue(subArgs, '--sample');
    try {
      const { recipe, observations } = loadScoutInputs(recipePath, observationsPath);
      if (action === 'validate') {
        const errors = validateScoutRecipe(recipe);
        observations.forEach((observation, idx) => errors.push(...validateScoutObservation(observation, recipe as any).map(e => `observations[${idx}]: ${e}`)));
        const result = { ok: errors.length === 0, action: 'scout-validate', recipePath, observationsPath, count: observations.length, errors };
        if (hasFlag(subArgs, '--json')) printJson(result);
        else if (errors.length === 0) console.log(`Scout recipe valid: ${recipePath}${observationsPath ? ` (${observations.length} local observations)` : ''}`);
        else console.error(`Scout recipe invalid:\n- ${errors.join('\n- ')}`);
        if (errors.length > 0) process.exit(1);
        return;
      }
      if (action === 'dry-run') {
        const result = runScoutDryRun({ recipe, observations });
        const outputPath = flagValue(subArgs, '--output') || flagValue(subArgs, '--out');
        if (outputPath && result.ok) {
          ensureParent(outputPath);
          writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');
        }
        if (hasFlag(subArgs, '--json')) printJson({ ...result, outputPath: outputPath || undefined, written: Boolean(outputPath && result.ok) });
        else {
          console.log(`${result.ok ? 'PASS' : 'FAIL'} ScoutNet dry-run: ${result.recipe?.id || recipePath}`);
          console.log(`observations=${result.observations.length} proposals=${result.proposals.length} checked=${result.coverage_report.sources_checked.length} unchecked=${result.coverage_report.sources_not_checked.length}`);
          console.log('review-only: trusted_world_model_updated=false trusted_pages_edited=false external_messages_sent=false live_web_crawl_performed=false');
          if (outputPath && result.ok) console.log(`Wrote dry-run report: ${outputPath}`);
          if (result.errors.length) console.error(`errors:\n- ${result.errors.join('\n- ')}`);
          if (result.warnings.length) console.log(`warnings: ${result.warnings.join('; ')}`);
        }
        if (!result.ok) process.exit(1);
        return;
      }
      console.error(`Unknown memory scout subcommand: ${action}`);
      printHelp();
      process.exit(1);
    } catch (err) {
      console.error(`ScoutNet failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (group === 'radar') {
    const action = args[1];
    const subArgs = args.slice(2);
    if (!action || action === '--help' || action === '-h') {
      printHelp();
      return;
    }
    if (action === 'score' || action === 'list') {
      const inputPath = flagValue(subArgs, '--input') || flagValue(subArgs, '--report') || flagValue(subArgs, '--scout-report');
      if (!inputPath) {
        console.error('Missing required --input <scout-dry-run-report.json>');
        process.exit(1);
      }
      try {
        const observations = loadScoutObservationsForRadar(inputPath);
        const candidates = scoreRadarCandidates({ scoutObservations: observations, allowSensitiveImmediate: hasFlag(subArgs, '--allow-sensitive-immediate') });
        const report = buildRadarReport({ candidates, source: inputPath });
        const outputPath = flagValue(subArgs, '--output') || flagValue(subArgs, '--out');
        if (outputPath) {
          ensureParent(outputPath);
          writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
        }
        if (hasFlag(subArgs, '--json')) printJson({ ok: true, action: action === 'score' ? 'radar-score' : 'radar-list', ...report, outputPath: outputPath || undefined, written: Boolean(outputPath) });
        else {
          console.log(`PASS Radar ${action}: candidates=${report.candidate_count} immediate=${report.band_counts['immediate-review']} daily=${report.band_counts['daily-brief']} weekly=${report.band_counts['weekly-digest']} archive=${report.band_counts.archive}`);
          console.log('review-only: user_facing_interrupt_sent=false trusted_pages_edited=false external_messages_sent=false automatic_notifications_enabled=false');
          for (const c of report.candidates) console.log(`- ${c.id} [${c.band}] score=${c.scores.final} ${c.title}`);
          if (outputPath) console.log(`Wrote radar report: ${outputPath}`);
        }
        return;
      } catch (err) {
        console.error(`Radar scoring failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    console.error(`Unknown memory radar subcommand: ${action}`);
    printHelp();
    process.exit(1);
  }

  if (group !== 'proposals') {
    console.error(`Unknown memory subcommand group: ${group}`);
    printHelp();
    process.exit(1);
  }
  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }

  const subArgs = args.slice(2);
  if (sub === 'validate') {
    const packet = loadPacketFromArgs(subArgs);
    const errors = validateSurfacingProposalPacket(packet);
    const result: MemoryProposalCommandResult = { ok: errors.length === 0, action: 'validate', errors };
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (errors.length === 0) console.log('Memory proposal packet valid.');
    else console.error(`Memory proposal packet invalid:\n- ${errors.join('\n- ')}`);
    if (errors.length > 0) process.exit(1);
    return;
  }

  if (sub === 'enqueue') {
    const packet = loadPacketFromArgs(subArgs);
    const dryRun = hasFlag(subArgs, '--dry-run') || !hasFlag(subArgs, '--yes');
    const result = enqueueMemoryProposalPacket(packet, { dryRun });
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (!result.ok) console.error(`Memory proposal packet invalid:\n- ${(result.errors || []).join('\n- ')}`);
    else if (result.duplicate) console.log(`Memory proposal already queued: ${result.proposal?.id}`);
    else if (dryRun) console.log(`Dry run: memory proposal packet would enqueue to ${result.queuePath}`);
    else console.log(`Queued memory proposal: ${result.proposal?.id}`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'reduce') {
    const claimLedgerPath = flagValue(subArgs, '--claim-ledger');
    const memoryQueuePath = flagValue(subArgs, '--memory-queue') || flagValue(subArgs, '--queue');
    if (!claimLedgerPath && !memoryQueuePath) {
      console.error('Missing input: pass --claim-ledger <claim-ledger.jsonl> and/or --memory-queue <memory-proposals.jsonl>');
      process.exit(1);
    }
    const reduced = reduceReviewJsonlToProposalPacket({
      claimLedgerPath,
      memoryQueuePath,
      limit: Number(flagValue(subArgs, '--limit') || 50),
    });
    const packetErrors = reduced.ok ? validateSurfacingProposalPacket(reduced.packet) : [];
    if (packetErrors.length) {
      reduced.ok = false;
      reduced.errors.push(...packetErrors.map(e => `packet: ${e}`));
      reduced.packet.validation.pass = false;
      reduced.packet.validation.errors = reduced.errors;
    }

    const outputPath = flagValue(subArgs, '--output') || flagValue(subArgs, '--out');
    if (outputPath && reduced.ok) {
      ensureParent(outputPath);
      writeFileSync(outputPath, JSON.stringify(reduced.packet, null, 2) + '\n', 'utf-8');
    }

    const shouldEnqueue = hasFlag(subArgs, '--enqueue');
    const dryRun = shouldEnqueue && (hasFlag(subArgs, '--dry-run') || !hasFlag(subArgs, '--yes'));
    const enqueueResult = shouldEnqueue && reduced.ok ? enqueueMemoryProposalPacket(reduced.packet, { dryRun }) : undefined;
    const ok = reduced.ok && (!shouldEnqueue || enqueueResult?.ok === true);

    if (hasFlag(subArgs, '--json')) printJson({ ...reduced, ok, outputPath: outputPath || undefined, written: Boolean(outputPath && reduced.ok), enqueue: enqueueResult });
    else {
      if (reduced.ok) console.log(`PASS reducer bridge: candidates=${reduced.stats.candidate_count} claims=${reduced.stats.claim_records_read} memory_proposals=${reduced.stats.memory_proposals_read}`);
      else console.error(`Reducer bridge failed:\n- ${reduced.errors.join('\n- ')}`);
      console.log('review-only: trusted_pages_edited=false external_messages_sent=false global_config_changed=false database_written=false');
      if (outputPath && reduced.ok) console.log(`Wrote reducer proposal packet: ${outputPath}`);
      if (shouldEnqueue) {
        if (!enqueueResult?.ok) console.error(`Reducer packet invalid for enqueue:\n- ${(enqueueResult?.errors || []).join('\n- ')}`);
        else if (enqueueResult.duplicate) console.log(`Memory proposal already queued: ${enqueueResult.proposal?.id}`);
        else if (dryRun) console.log(`Dry run: reducer packet would enqueue to ${enqueueResult.queuePath}`);
        else console.log(`Queued reducer proposal: ${enqueueResult.proposal?.id}`);
      }
      if (reduced.warnings.length) console.log(`warnings: ${reduced.warnings.join('; ')}`);
    }
    if (!ok) process.exit(1);
    return;
  }

  if (sub === 'list') {
    const result = listMemoryProposalPackets();
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (!result.queueExists) console.log(`No memory proposal review queue found at ${result.queuePath}`);
    else if (result.count === 0) console.log(`No memory proposals queued at ${result.queuePath}`);
    else console.log((result.proposals || []).map(p => `${p.id}\t${p.status}\t${p.created_at}\t${p.candidate_count}\t${p.outcome}`).join('\n'));
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'export') {
    const format = flagValue(subArgs, '--format') || 'markdown';
    if (format !== 'markdown') {
      console.error(`Unsupported memory proposals export format: ${format}`);
      process.exit(1);
    }
    const outputPath = flagValue(subArgs, '--output');
    const result = exportMemoryProposalPackets({ format: 'markdown' });
    if (result.ok && outputPath) {
      ensureParent(outputPath);
      writeFileSync(outputPath, result.content || '', 'utf-8');
      result.outputPath = outputPath;
      result.written = true;
    }
    if (hasFlag(subArgs, '--json')) printJson(result);
    else if (outputPath) console.log(`Wrote memory proposal review export: ${outputPath}`);
    else console.log(result.content || '');
    if (!result.ok) process.exit(1);
    return;
  }

  console.error(`Unknown memory proposals subcommand: ${sub}`);
  printHelp();
  process.exit(1);
}


function printContextPackHuman(pack: ReturnType<typeof loadContextPackV2>): void {
  console.log(`${pack.status.toUpperCase()} context-pack v2 [${pack.request.mode}]: ${pack.request.topic || '(no topic)'}`);
  console.log(`policy: namespaces=${pack.request.allowed_namespaces.join(',')} max_privacy=${pack.request.max_privacy} max_sensitivity=${pack.request.max_sensitivity}`);
  for (const item of pack.items) {
    console.log(`- ${item.id} [${item.type}, ${item.namespace}, ${item.privacy}, ${item.sensitivity}] confidence=${item.confidence}`);
    console.log(`  ${item.claim}`);
    if (item.evidence_span_ids.length) console.log(`  evidence: ${item.evidence_span_ids.map(redactLocalPaths).join(', ')}`);
  }
  if (pack.evidence_index.length) console.log(`evidence_index: ${pack.evidence_index.map(e => redactLocalPaths(e.span_id)).join(', ')}`);
  if (pack.warnings.length) console.log(`warnings: ${pack.warnings.map(redactLocalPaths).join('; ')}`);
}

function redactLocalPaths(value: unknown): string {
  const home = process.env.HOME || '';
  let text = String(value || '');
  if (home) text = text.replaceAll(home, '$HOME');
  return text
    .replace(/\\/g, '/')
    .replace(/(?:\$HOME|\/Users\/[^\s:#;,]+|\/private\/var\/[^\s:#;,]+|\/var\/folders\/[^\s:#;,]+|\/tmp\/[^\s:#;,]+)([^\s:#;,]*)/g, match => {
      const cleaned = match.replace(/^\$HOME/, home || '$HOME');
      return safeSourceLabel(cleaned);
    });
}

function contextPackEvidenceOrdinal(pack: ReturnType<typeof loadContextPackV2>): Map<string, string> {
  return new Map(pack.evidence_index.map((ev, index) => [ev.span_id, `E${index + 1}`]));
}

function contextPackAbstainReasons(pack: ReturnType<typeof loadContextPackV2>): string[] {
  const explicit = pack.warnings.filter(w => /abstain/i.test(w)).map(redactLocalPaths);
  if (explicit.length) return explicit;
  if (pack.status !== 'abstain') return [];
  const reasons: string[] = [];
  if (pack.excluded.policy > 0) reasons.push(`${pack.excluded.policy} matching record(s) blocked by namespace/privacy/sensitivity policy`);
  if (pack.excluded.mode > 0) reasons.push(`${pack.excluded.mode} record(s) did not match mode=${pack.request.mode}`);
  if (pack.excluded.query > 0) reasons.push(`${pack.excluded.query} record(s) did not match topic`);
  if (!reasons.length) reasons.push('no review-only claim records available');
  return reasons;
}

function printContextPackCompactHuman(pack: ReturnType<typeof loadContextPackV2>): void {
  const topic = pack.request.topic || '(no topic)';
  const evidenceOrdinal = contextPackEvidenceOrdinal(pack);
  const staleWarnings = pack.warnings.filter(w => /stale|superseded|contradicted/i.test(w)).map(redactLocalPaths);
  const sensitivityNotes = pack.warnings.filter(w => /privacy|sensitivity|review/i.test(w) && !/abstain/i.test(w)).map(redactLocalPaths);
  const otherWarnings = pack.warnings.filter(w => !staleWarnings.includes(redactLocalPaths(w)) && !sensitivityNotes.includes(redactLocalPaths(w)) && !/abstain/i.test(w)).map(redactLocalPaths);

  console.log(`${pack.status.toUpperCase()} context-pack v2 [${pack.request.mode}] topic="${redactLocalPaths(topic)}"`);
  console.log(`policy: namespaces=${pack.request.allowed_namespaces.join(',')} max_privacy=${pack.request.max_privacy} max_sensitivity=${pack.request.max_sensitivity}`);
  console.log(`counts: items=${pack.items.length} evidence=${pack.evidence_index.length} excluded_policy=${pack.excluded.policy} excluded_mode=${pack.excluded.mode} excluded_query=${pack.excluded.query}`);

  if (pack.status === 'abstain') {
    console.log('abstain_reasons:');
    for (const reason of contextPackAbstainReasons(pack)) console.log(`- ${reason}`);
  }

  if (pack.items.length) {
    console.log('items:');
    for (const item of pack.items) {
      const evidence = item.evidence_span_ids.map(id => evidenceOrdinal.get(id) || redactLocalPaths(id)).join(', ') || 'none';
      console.log(`- ${item.id} [${item.type}; ${item.status}; ${item.namespace}/${item.privacy}/${item.sensitivity}; confidence=${item.confidence}; evidence=${evidence}]`);
      console.log(`  ${redactLocalPaths(item.claim)}`);
    }
  }

  if (pack.evidence_index.length) {
    console.log('evidence_index:');
    for (const ev of pack.evidence_index) {
      const label = evidenceOrdinal.get(ev.span_id) || 'E?';
      const source = redactLocalPaths(ev.source_id || ev.slug || ev.section || ev.span_id);
      const lines = ev.start_line && ev.end_line ? ` L${ev.start_line}-L${ev.end_line}` : '';
      console.log(`- ${label}: ${redactLocalPaths(ev.span_id)} source=${source}${lines} claims=${ev.claim_ids.join(',')}`);
    }
  }

  if (staleWarnings.length) { console.log('stale_warnings:'); for (const w of staleWarnings) console.log(`- ${w}`); }
  if (sensitivityNotes.length) { console.log('sensitivity_notes:'); for (const w of sensitivityNotes) console.log(`- ${w}`); }
  if (otherWarnings.length) { console.log('warnings:'); for (const w of otherWarnings) console.log(`- ${w}`); }
}

function printSurfacingPacketHuman(packet: any): void {
  console.log(`${packet?.validation?.pass ? 'PASS' : 'FAIL'} ${packet?.packet_type || 'governed_surfacing_proposal_packet'}: ${packet?.outcome || 'unknown'}`);
  console.log(`review_only: trusted_pages_edited=${packet?.guardrails?.trusted_pages_edited}, external_messages_sent=${packet?.guardrails?.external_messages_sent}, global_config_changed=${packet?.guardrails?.global_config_changed}`);
  console.log(`context: ${packet?.context?.kind || 'unknown'}${packet?.context?.path ? ` ${packet.context.path}` : ''} hash=${packet?.context?.hash || ''}`);
  console.log(`candidates: ${Array.isArray(packet?.candidates) ? packet.candidates.length : 0}`);
  for (const c of Array.isArray(packet?.candidates) ? packet.candidates : []) console.log(`- ${c.id} [${c.proposed_action}, ${c.sensitivity}] ${c.claim}`);
}

function printRouteHuman(result: ReturnType<typeof routeTypedMemory>): void {
  console.log(`${result.pass ? 'PASS' : 'MISS'} typed-memory route: ${result.query || result.context || ''}`);
  console.log(`routes: ${result.matched_routes.map(r => `${r.id}:${r.score}`).join(', ') || 'none'}`);
  console.log(`types: ${result.desired_memory_types.join(', ') || 'none'}`);
  if (result.warnings.length > 0) console.log(`warnings: ${result.warnings.join('; ')}`);
  for (const r of result.results) {
    console.log(`- ${r.id} [${r.memory_type}, ${r.sensitivity}, ${r.surfacing_policy || 'unspecified'}] score=${r.score}`);
    console.log(`  ${r.claim}`);
    console.log(`  source: ${safeSourceLabel(r.source.path)}`);
  }
}

function printHelp(): void {
  console.log(`gbrain memory route --query "..." [--context "..."] [--context-file path] [--limit 8] [--include-high] [--json]
gbrain memory surface --query "..." [--context "..."] [--context-file path] [--limit 8] [--enqueue] [--dry-run|--yes] [--json]
gbrain memory context-pack --mode <daily|meeting|decision|project> --query "..." [--allowed-namespaces world,ventures] [--max-privacy internal] [--max-sensitivity medium] [--limit 8] [--compact] [--json]
gbrain memory scout validate --recipe <recipe.json> [--observations <observations.json>] [--json]
gbrain memory scout dry-run --recipe <recipe.json> --observations <observations.json> [--output <report.json>] [--json]
gbrain memory radar score --input <scout-dry-run-report.json> [--output <radar-report.json>] [--json]
gbrain memory radar list  --input <scout-dry-run-report.json> [--json]
gbrain memory proposals validate --packet <packet.json> [--json]
gbrain memory proposals enqueue  --packet <packet.json> [--dry-run|--yes] [--json]
gbrain memory proposals reduce   [--claim-ledger <claim-ledger.jsonl>] [--memory-queue <memory-proposals.jsonl>] [--output <packet.json>] [--enqueue] [--dry-run|--yes] [--json]
gbrain memory proposals list [--json]
gbrain memory proposals export [--format markdown] [--output <review.md>] [--json]

Review-only memory bridge. route, surface, scout, and radar never edit trusted pages, send external messages, perform live web crawls, notify users, or change global config. Proposal enqueue paths default to dry-run unless --yes is supplied.`);
}
