import { describe, expect, test } from 'bun:test';
import { normalizeJsonCastParams } from '../src/core/postgres-engine.ts';

describe('Postgres executeRaw JSONB parameter normalization', () => {
  test('parses JSON.stringify object params for $N::jsonb casts', () => {
    const params = normalizeJsonCastParams(
      'UPDATE minion_jobs SET data = $1::jsonb WHERE id = $2',
      [JSON.stringify({ child_ids: [1, 2] }), 42],
    );
    expect(params).toEqual([{ child_ids: [1, 2] }, 42]);
  });

  test('parses JSON string arrays for jsonb[] casts', () => {
    const params = normalizeJsonCastParams(
      'SELECT * FROM unnest($1::int[], $2::jsonb[])',
      [[1, 2], [JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 })]],
    );
    expect(params).toEqual([[1, 2], [{ a: 1 }, { b: 2 }]]);
  });

  test('leaves non-json params and non-json casts untouched', () => {
    const original = ['not-json', JSON.stringify({ ok: true })];
    const params = normalizeJsonCastParams('SELECT $1::text, $2::text', original);
    expect(params).toBe(original);
  });
});
