import { describe, test, expect } from 'bun:test';
import { dedupeSignals, extractSignals, type Signal } from '../src/tasks/bookmarks-agent.ts';

describe('bookmarks-agent helpers', () => {
  test('extractSignals classifies sovereign AI as critical', () => {
    const signals = extractSignals('We should track sovereign AI and on-premise deployments.');
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe('critical');
    expect(signals[0]?.relevance).toContain('Sovereign AI');
  });

  test('extractSignals can surface multiple keyword classes from one item', () => {
    const signals = extractSignals('India AI Mission updates mention Sarvam and MLX benchmarks for local AI.');
    expect(signals.map(signal => signal.type)).toEqual(['critical', 'notable']);
  });

  test('dedupeSignals suppresses identical duplicate signals', () => {
    const duplicate: Signal = {
      type: 'critical',
      source: 'bookmarks',
      content: 'Same source snippet',
      relevance: 'Sovereign AI / data infrastructure',
      timestamp: '2026-04-27T00:00:00.000Z',
    };

    expect(dedupeSignals([
      duplicate,
      { ...duplicate, timestamp: '2026-04-27T00:01:00.000Z' },
    ])).toEqual([duplicate]);
  });
});
