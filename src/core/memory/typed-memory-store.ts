import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, relative } from 'path';
import type { TypedMemoryItem } from './types.ts';

export type TypedMemoryStoreLoadResult = {
  path?: string;
  displayPath?: string;
  items: TypedMemoryItem[];
  warnings: string[];
};

function findWorkspaceRoot(start: string): string {
  let dir = start;
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, 'projects/gbrain-living-memory/PROJECT.md'))) return dir;
    dir = dirname(dir);
  }
  return '/Users/a/.openclaw/workspace';
}

export function defaultTypedMemoryFixturePath(cwd = process.cwd()): string | undefined {
  if (process.env.GBRAIN_TYPED_MEMORY_FIXTURES) return process.env.GBRAIN_TYPED_MEMORY_FIXTURES;
  const root = findWorkspaceRoot(cwd);
  const candidate = join(root, 'projects/gbrain-living-memory/implementation/typed-memory-fixtures.jsonl');
  return existsSync(candidate) ? candidate : undefined;
}

function minimalValidationErrors(value: any): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['record must be an object'];
  for (const key of ['id', 'memory_type', 'title', 'claim', 'sensitivity']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) errors.push(`${key} is required`);
  }
  if (!value.source || typeof value.source !== 'object' || Array.isArray(value.source)) errors.push('source is required');
  else {
    if (typeof value.source.path !== 'string' || value.source.path.length === 0) errors.push('source.path is required');
    if (typeof value.source.quote !== 'string' || value.source.quote.length === 0) errors.push('source.quote is required');
  }
  return errors;
}

export function loadTypedMemoryStore(opts: { path?: string; cwd?: string } = {}): TypedMemoryStoreLoadResult {
  const cwd = opts.cwd || process.cwd();
  const fixturePath = opts.path || defaultTypedMemoryFixturePath(cwd);
  if (!fixturePath) return { items: [], warnings: ['no typed-memory JSONL fixture path found'] };
  const absolutePath = isAbsolute(fixturePath) ? fixturePath : join(cwd, fixturePath);
  const displayPath = (() => {
    const root = findWorkspaceRoot(cwd);
    const rel = relative(root, absolutePath);
    return rel && !rel.startsWith('..') ? rel : absolutePath;
  })();
  if (!existsSync(absolutePath)) return { path: absolutePath, displayPath, items: [], warnings: [`typed-memory JSONL file not found: ${absolutePath}`] };

  const warnings: string[] = [];
  const items: TypedMemoryItem[] = [];
  const content = readFileSync(absolutePath, 'utf-8');
  content.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      const errors = minimalValidationErrors(parsed);
      if (errors.length > 0) {
        warnings.push(`line ${idx + 1}: ${errors.join(', ')}`);
        return;
      }
      items.push(parsed as TypedMemoryItem);
    } catch (err) {
      warnings.push(`line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { path: absolutePath, displayPath, items, warnings };
}
