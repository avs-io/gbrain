import { enqueueJob, listJobs, retryJob } from '../core/ai/job-queue.ts';
import { routeModel } from '../core/ai/model-router.ts';
import type { PrivacyTier, WorkKind } from '../core/ai/privacy-policy.ts';

function parse(args: string[]): { kind?: WorkKind; privacy?: PrivacyTier; json: boolean; allowCloudEscalation: boolean; queuePath?: string; namespace?: string; inputRef?: string; provider?: string; status?: string; id?: string } {
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--allow-cloud-escalation') allowCloudEscalation = true;
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
    else if (a && !a.startsWith('--') && !id) id = a;
  }
  return { kind, privacy, json, allowCloudEscalation, queuePath, namespace, inputRef, provider, status, id };
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
  if (sub === 'jobs') {
    const [action, ...jobArgs] = rest;
    const flags = parse(jobArgs);
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
  throw new Error('Usage: gbrain ai route ... | gbrain ai jobs enqueue|list|retry ...');
}
