import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runQualityCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, nested, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    help();
    return;
  }
  if (sub !== 'arena') {
    throw new Error(`Unknown quality subcommand: ${sub}. Expected: arena`);
  }
  if (!nested || nested === '--help' || nested === '-h') {
    help();
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const script = resolve(root, 'ops', 'quality-arena', 'quality-arena.mjs');
  const mapped = mapArenaCommand(nested, rest);
  const result = spawnSync(process.execPath, [script, ...mapped], { stdio: 'inherit', cwd: root });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function mapArenaCommand(command: string, args: string[]): string[] {
  if (command === 'create') return ['create', ...args];
  if (command === 'status') return ['status', ...args];
  if (command === 'snapshot') return ['snapshot', ...args];
  if (command === 'dispatch-plan') return ['dispatch-plan', ...args];
  if (command === 'pilot-eonic') return ['pilot-eonic', ...args];
  if (command === 'run') return ['run', ...args];
  throw new Error(`Unknown quality arena command: ${command}`);
}

function help(): void {
  console.log(`Usage:
  gbrain quality arena create --goal ID --project NAME --artifact PATH --outcome-contract PATH --context-pack PATH --quality-policy PATH --json
  gbrain quality arena status <arena_id> --json
  gbrain quality arena snapshot <arena_id> --json
  gbrain quality arena dispatch-plan <arena_id> --json
  gbrain quality arena pilot-eonic --json`);
}
