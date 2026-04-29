import { describe, expect, test } from 'bun:test';
import { parseMarkdown } from '../src/core/markdown.ts';

describe('parseMarkdown invalid-frontmatter fallback', () => {
  test('unrecoverable YAML remains readable in validate mode', () => {
    const content = `---\ntype: note\ntags: [memory, living\n---\n\nBody stays readable.`;

    const parsed = parseMarkdown(content, 'notes/broken-note.md', { validate: true });

    expect(parsed.slug).toBe('notes/broken-note');
    expect(parsed.type).toBe('note');
    expect(parsed.title).toBe('Broken Note');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.compiled_truth).toContain('Body stays readable.');
    expect(parsed.errors).toBeDefined();
  });

  test('recoverable nested quoted titles still parse repaired frontmatter', () => {
    const content = `---\ntype: concept\ntitle: "P "I" L"\ntags: [frontmatter]\n---\n\nRecovered body.`;

    const parsed = parseMarkdown(content, 'recovered.md', { validate: true });

    expect(parsed.slug).toBe('recovered');
    expect(parsed.type).toBe('concept');
    expect(parsed.title).toBe('P "I" L');
    expect(parsed.tags).toEqual(['frontmatter']);
    expect(parsed.compiled_truth).toBe('Recovered body.');
    expect(parsed.errors?.map((error) => error.code)).toContain('NESTED_QUOTES');
    expect(parsed.errors?.map((error) => error.code)).not.toContain('YAML_PARSE');
  });
});
