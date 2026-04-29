import { readFile } from 'node:fs/promises';
import { enqueueJob, listJobs, retryJob, updateJob } from '../core/ai/job-queue.ts';
import { routeModel } from '../core/ai/model-router.ts';
import { buildMemoryAtomProposal, enqueueMemoryAtomProposal, listMemoryAtomProposals, proposeMemoryAtomFromSpan } from '../core/ai/memory-atom-proposal.ts';
import { validateProposalForPromotion } from '../core/ai/proposal-promotion-gate.ts';
import { verifyClaimSupport } from '../core/ai/claim-support-verifier.ts';
import { runLocalIntelligenceJob } from '../core/ai/local-runner.ts';
import type { PrivacyTier, WorkKind } from '../core/ai/privacy-policy.ts';

function parse(args: string[]): { kind?: WorkKind; privacy?: PrivacyTier; json: boolean; allowCloudEscalation: boolean; queuePath?: string; namespace?: string; inputRef?: string; provider?: string; status?: string; id?: string; dryRun: boolean; yes: boolean; spanId?: string; claim?: string; atomType?: string; sensitivity?: string; subjectEntities?: string[]; quote?: string; explanation?: string; jobJson?: string; proposalJson?: string } {
  let kind: WorkKind | undefined;
  let privacy: PrivacyTier | undefined;
  let json = false;
  let allowCloudEscalation = false;
  let queuePath: string | undefined;
  let namespace: string | undefined;
  let inputRef: string | undefined;
  let provider: string | undefined;
  let status: string | undefined;
  let id: string | undefined;
  let dryRun = false;
  let yes = false;
  let spanId: string | undefined;
  let claim: string | undefined;
  let atomType: string | undefined;
  let sensitivity: string | undefined;
  let subjectEntities: string[] | undefined;
  let quote: string | undefined;
  let explanation: string | undefined;
  let jobJson: string | undefined;
  let proposalJson: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--allow-cloud-escalation') allowCloudEscalation = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--yes') yes = true;
    else if (a === '--kind') kind = args[++i] as WorkKind;
    else if (a?.startsWith('--kind=')) kind = a.slice(7) as WorkKind;
    else if (a === '--privacy') privacy = args[++i] as PrivacyTier;
    else if (a?.startsWith('--privacy=')) privacy = a.slice(10) as PrivacyTier;
    else if (a === '--queue-path') queuePath = args[++i];
    else if (a?.startsWith('--queue-path=')) queuePath = a.slice(13);
    else if (a === '--namespace') namespace = args[++i];
    else if (a?.startsWith('--namespace=')) namespace = a.slice(12);
    else if (a === '--input-ref') inputRef = args[++i];
    else if (a?.startsWith('--input-ref=')) inputRef = a.slice(12);
    else if (a === '--provider') provider = args[++i];
    else if (a?.startsWith('--provider=')) provider = a.slice(11);
    else if (a === '--status') status = args[++i];
    else if (a?.startsWith('--status=')) status = a.slice(9);
    else if (a === '--from-span') spanId = args[++i];
    else if (a?.startsWith('--from-span=')) spanId = a.slice(12);
    else if (a === '--claim') claim = args[++i];
    else if (a?.startsWith('--claim=')) claim = a.slice(8);
    else if (a === '--atom-type') atomType = args[++i];
    else if (a?.startsWith('--atom-type=')) atomType = a.slice(12);
    else if (a === '--sensitivity') sensitivity = args[++i];
    else if (a?.startsWith('--sensitivity=')) sensitivity = a.slice(14);
    else if (a === '--subject-entity') (subjectEntities ||= []).push(args[++i]);
    else if (a?.startsWith('--subject-entity=')) (subjectEntities ||= []).push(a.slice(17));
    else if (a === '--quote') quote = args[++i];
    else if (a?.startsWith('--quote=')) quote = a.slice(8);
    else if (a === '--explanation') explanation = args[++i];
    else if (a?.startsWith('--explanation=')) explanation = a.slice(14);
    else if (a === '--job-id') id = args[++i];
    else if (a?.startsWith('--job-id=')) id = a.slice(9);
    else if (a === '--job-json') jobJson = args[++i];
    else if (a?.startsWith('--job-json=')) jobJson = a.slice(11);
    else if (a === '--proposal-json') proposalJson = args[++i];
    else if (a?.startsWith('--proposal-json=')) proposalJson = a.slice(16);
    else if (a && !a.startsWith('--') && !id) id = a;
  }
  return { kind, privacy, json, allowCloudEscalation, queuePath, namespace, inputRef, provider, status, id, dryRun, yes, spanId, claim, atomType, sensitivity, subjectEntities, quote, explanation, jobJson, proposalJson };
}

export async function runAiCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === 'route') {
    const flags = parse(rest);
    if (!flags.kind || !flags.privacy) throw new Error('Usage: gbrain ai route --kind <kind> --privacy <P0|P1|P2|P3> [--allow-cloud-escalation] [--json]');
    const route = routeModel({ kind: flags.kind, privacy: flags.privacy, allowCloudEscalation: flags.allowCloudEscalation });
    if (flags.json) console.log(JSON.stringify(route, null, 2));
    else console.log(`${route.preferred_provider} ${route.fallback_providers.join(',')}`);
    return;
  }
  if (sub === 'memory-atoms') {
    const [action, ...atomArgs] = rest;
    const flags = parse(atomArgs);
    if (action === 'verify') {
      if (!flags.claim || !flags.spanId || !flags.quote) throw new Error('Usage: gbrain ai memory-atoms verify --claim <text> --from-span <gbs1> --quote <text> [--explanation <text>] [--json]');
      const result = verifyClaimSupport({ claim: flags.claim, evidence_spans: [{ span_id: flags.spanId, quote: flags.quote }], explanation: flags.explanation });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(result.support_level);
      return;
    }
    if (action === 'propose') {
      if (!flags.spanId || !flags.claim || !flags.atomType || !flags.namespace || !flags.sensitivity) throw new Error('Usage: gbrain ai memory-atoms propose --from-span <gbs1> --claim <text> --atom-type <type> --namespace <ns> --sensitivity <P0|P1|P2|P3> [--dry-run|--yes] [--json]');
      const proposalResult = proposeMemoryAtomFromSpan({ span_id: flags.spanId, claim: flags.claim, atom_type: flags.atomType as any, suggested_namespace: flags.namespace, sensitivity: flags.sensitivity as any, subject_entities: flags.subjectEntities, quote: flags.quote || flags.claim });
      if (!proposalResult.ok || !proposalResult.proposal) {
        const payload = { ok: false, errors: proposalResult.errors || ['failed to build memory atom proposal'] };
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      const record = proposalResult.proposal;
      const result = enqueueMemoryAtomProposal(record, { queuePath: flags.queuePath, dryRun: flags.dryRun || !flags.yes });
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else if (result.duplicate) console.log(`Memory atom proposal already queued: ${record.proposal_id}`);
      else if (result.dryRun) console.log(`Dry run: memory atom proposal would append to ${result.path}`);
      else console.log(`Queued memory atom proposal: ${record.proposal_id}`);
      return;
    }
    if (action === 'gate') {
      if (!flags.proposalJson) throw new Error('Usage: gbrain ai memory-atoms gate --proposal-json <file> [--json]');
      const proposal = JSON.parse(await readFile(flags.proposalJson, 'utf8'));
      const result = validateProposalForPromotion(proposal, { allowStrongInference: false });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (action === 'list') {
      const result = listMemoryAtomProposals({ queuePath: flags.queuePath });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
  if (sub === 'jobs') {
    const [action, ...jobArgs] = rest;
    const flags = parse(jobArgs);
    if (action === 'run') {
      const queuePath = flags.queuePath;
      const job = flags.jobJson ? JSON.parse(await readFile(flags.jobJson, 'utf8')) : (() => {
        if (!flags.id) throw new Error('Usage: gbrain ai jobs run --queue-path <path> --job-id <id> [--json]');
        const listed = listJobs({ path: queuePath });
        return listed.jobs.find(entry => entry.id === flags.id);
      })();
      if (!job) throw new Error('job not found');
      const result = runLocalIntelligenceJob(job, { queuePath });
      if (flags.yes && queuePath && job.id) {
        updateJob({ id: job.id, status: result.status === 'succeeded' ? 'succeeded' : result.status === 'failed' ? 'failed' : 'queued', output_ref: JSON.stringify(result), error: result.errors.length ? result.errors.join('; ') : null, completed_at: new Date().toISOString() }, { path: queuePath });
      }
      console.log(JSON.stringify({ ...result, dry_run: !flags.yes }, null, 2));
      return;
    }
    if (action === 'enqueue') {
      if (!flags.kind || !flags.privacy || !flags.namespace || !flags.inputRef) throw new Error('Usage: gbrain ai jobs enqueue --kind <kind> --privacy <P0|P1|P2|P3> --namespace <ns> --input-ref <ref> [--provider <provider>] [--queue-path <path>] [--json]');
      const route = routeModel({ kind: flags.kind, privacy: flags.privacy, allowCloudEscalation: flags.allowCloudEscalation });
      const result = enqueueJob({
        work_kind: flags.kind,
        privacy_tier: flags.privacy,
        namespace: flags.namespace,
        input_ref: flags.inputRef,
        provider: flags.provider as any,
        allowCloudEscalation: flags.allowCloudEscalation,
      }, { path: flags.queuePath });
      const payload = { ...result, route };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (action === 'list') {
      const result = listJobs({ path: flags.queuePath, status: flags.status as any, namespace: flags.namespace, work_kind: flags.kind });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (action === 'retry') {
      if (!flags.id) throw new Error('Usage: gbrain ai jobs retry <id> [--queue-path <path>] [--json]');
      const result = retryJob({ id: flags.id }, { path: flags.queuePath });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
  throw new Error('Usage: gbrain ai route ... | gbrain ai jobs enqueue|list|retry ... | gbrain ai memory-atoms verify|propose|list ...');
}
