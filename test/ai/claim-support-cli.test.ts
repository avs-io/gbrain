import { describe, expect, test } from 'bun:test';
import { runAiCommand } from '../../src/commands/ai.ts';

describe('ai claim support cli', () => {
  test('verify emits json', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: any) => { logs.push(String(msg)); };
    try {
      await runAiCommand(null, ['memory-atoms', 'verify', '--claim', 'Chief prefers review-only proposal flows for memory atoms.', '--from-span', 'gbs1:src:page#section:L1-L2', '--quote', 'Chief prefers review-only proposal flows for memory atoms.', '--json']);
    } finally {
      console.log = orig;
    }
    expect(JSON.parse(logs.join('\n')).support_level).toBe('direct_quote');
  });
});
