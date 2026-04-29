import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, detectRequestedAspects, extractQueryEntities } from '../../src/core/answer/index.ts';

describe('QueryFrame builder', () => {
  test('parses explicit requested aspects from a multi-part synthetic query', () => {
    const frame = buildQueryFrame('What was Project Atlas, when did it shift, and why was the prior option dropped?');

    expect(frame.requestedAspects).toEqual(expect.arrayContaining(['definition', 'timeline', 'change', 'rationale', 'prior_state']));
    expect(frame.subquestions.length).toBeGreaterThanOrEqual(2);
    expect(frame.cues.multiPart).toBe(true);
    expect(frame.cues.temporal).toBe(true);
    expect(frame.entities.map(entity => entity.text)).toContain('Project Atlas');
  });

  test('detects incident and relationship asks without relying on private fixture names', () => {
    const frame = buildQueryFrame('What was my relationship with Person Alpha like and what high friction incidents existed?');

    expect(frame.requestedAspects).toEqual(expect.arrayContaining(['relationship', 'incidents', 'summary']));
    expect(frame.entities.map(entity => entity.text)).toContain('Person Alpha');
  });

  test('extracts quoted spans, acronyms, capitalized spans, and supplied aliases', () => {
    const entities = extractQueryEntities('Why did "North Rail" move from ACC to MWAL for Project Beta?', { aliases: ['north rail'] });
    const names = entities.map(entity => entity.text);

    expect(names).toEqual(expect.arrayContaining(['North Rail', 'ACC', 'MWAL', 'Project Beta']));
    expect(entities.find(entity => entity.text === 'North Rail')?.kind).toBe('quoted');
  });

  test('recognizes Chief-style fixture aspects generically', () => {
    const frame = buildQueryFrame('What supplements was Anu using during pregnancy and when did we shift to ferrous ascorbate? What was ferritin?');

    expect(frame.requestedAspects).toEqual(expect.arrayContaining(['list_stack', 'timeline', 'change', 'definition']));
    expect(frame.subquestions).toHaveLength(2);
    expect(frame.entities.map(entity => entity.text)).toContain('Anu');
  });

  test('falls back to summary for underspecified recall questions', () => {
    expect(detectRequestedAspects('tell me about the launch')).toEqual(['summary']);
  });
});
