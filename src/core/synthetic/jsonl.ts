import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { validateSyntheticQueryCase, validateSyntheticRecord } from './validator.ts';
import type { SyntheticQueryCase, SyntheticRecord } from './types.ts';

export function parseSyntheticJsonl<T>(content: string, validator: (value: unknown) => { path: string; message: string }[]): { items: T[]; errors: string[] } {
  const items: T[] = [];
  const errors: string[] = [];
  for (const [idx, line] of content.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const issues = validator(parsed);
      if (issues.length) errors.push(`line ${idx + 1}: ${issues.map(i => `${i.path || '<root>'}: ${i.message}`).join('; ')}`);
      else items.push(parsed as T);
    } catch (e) {
      errors.push(`line ${idx + 1}: ${(e as Error).message}`);
    }
  }
  return { items, errors };
}

export function readSyntheticRecordsJsonl(path: string): { items: SyntheticRecord[]; errors: string[] } {
  return parseSyntheticJsonl<SyntheticRecord>(readFileSync(path, 'utf8'), validateSyntheticRecord);
}

export function readSyntheticCasesJsonl(path: string): { items: SyntheticQueryCase[]; errors: string[] } {
  return parseSyntheticJsonl<SyntheticQueryCase>(readFileSync(path, 'utf8'), validateSyntheticQueryCase);
}

export function appendSyntheticJsonl(path: string, item: SyntheticRecord | SyntheticQueryCase): void {
  appendFileSync(path, `${JSON.stringify(item)}\n`);
}

export function writeSyntheticJsonl(path: string, items: Array<SyntheticRecord | SyntheticQueryCase>): void {
  writeFileSync(path, items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''));
}

