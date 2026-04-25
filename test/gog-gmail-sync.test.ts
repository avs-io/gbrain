/**
 * Tests for gog-gmail-sync connector.
 *
 * Uses dependency injection — no live gog CLI or filesystem writes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGogGmailSync, type GogGmailSyncDeps } from '../src/commands/gog-gmail-sync.ts';

function mockDeps(overrides: Partial<GogGmailSyncDeps> = {}): GogGmailSyncDeps & {
  written: Map<string, string>;
  executed: string[][];
} {
  const written = new Map<string, string>();
  const executed: string[][] = [];
  return {
    executed,
    written,
    execGog: (args) => {
      executed.push(args);
      return '{}';
    },
    writeFile: (p, d) => written.set(p, d),
    mkdir: () => {},
    rootDir: '/mock/root',
    ...overrides,
  };
}

describe('gog-gmail-sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prints help with --help', () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runGogGmailSyncCommand } = require('../src/commands/gog-gmail-sync.ts');
    runGogGmailSyncCommand(['--help']);
    expect(spy).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    spy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('rejects invalid date format', () => {
    const d = mockDeps();
    expect(() => runGogGmailSync(['--date', 'not-a-date'], d)).toThrow('Invalid date format');
  });

  it('fetches high-signal labels by default', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [] });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync([], d);
    expect(result.labelsFetched).toBe(3); // SENT, STARRED, IMPORTANT
    expect(result.threadsFetched).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('fetches a specific label with --label', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ message: { id: 't1', subject: 'Test', from: 'a@b.com', date: '2026-04-25' } });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'starred'], d);
    expect(result.labelsFetched).toBe(1);
    expect(result.threadsFetched).toBe(1);
    expect(result.messagesNormalized).toBe(1);
  });

  it('archives thread list and message JSON', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1', snippet: 'hello' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ message: { id: 't1', subject: 'Hi', from: 'a@b.com', date: '2026-04-25', snippet: 'hello world' } });
        }
        return '{}';
      },
    });
    runGogGmailSync(['--label', 'sent', '--date', '2026-04-25'], d);
    expect(d.written.has('/mock/root/raw/sources/archive/gmail-gog/2026-04-25/threads-sent.json')).toBe(true);
    expect(d.written.has('/mock/root/raw/sources/archive/gmail-gog/2026-04-25/messages/thread-t1.json')).toBe(true);
    expect(d.written.has('/mock/root/raw/sources/events/gmail-gog/2026-04-25/thread-t1.md')).toBe(true);
  });

  it('normalizes email to markdown with frontmatter', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({
            message: {
              id: 't1',
              subject: 'Meeting Tomorrow',
              from: 'alice@example.com',
              to: 'bob@example.com',
              date: '2026-04-25T10:00:00Z',
              snippet: 'Can we meet at 3pm?',
              labels: ['SENT'],
            },
          });
        }
        return '{}';
      },
    });
    runGogGmailSync(['--label', 'sent', '--date', '2026-04-25'], d);
    const md = d.written.get('/mock/root/raw/sources/events/gmail-gog/2026-04-25/thread-t1.md')!;
    expect(md).toContain('subject: "Meeting Tomorrow"');
    expect(md).toContain('from: "alice@example.com"');
    expect(md).toContain('to: "bob@example.com"');
    expect(md).toContain('# Meeting Tomorrow');
    expect(md).toContain('Can we meet at 3pm?');
    expect(md).toContain('Source: gmail-gog');
  });

  it('dry-run does not write files', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ message: { id: 't1', subject: 'Test', from: 'a@b.com' } });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'sent', '--dry-run'], d);
    expect(result.threadsFetched).toBe(1);
    expect(result.messagesNormalized).toBe(0); // dry-run counts threads but doesn't fetch/normalize
    expect(d.written.size).toBe(0);
  });

  it('handles gog list failure gracefully', () => {
    const d = mockDeps({
      execGog: () => { throw new Error('gog: auth expired'); },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Failed to list threads');
  });

  it('handles gog get failure gracefully', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        throw new Error('gog: not found');
      },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Failed to fetch thread');
  });

  it('handles threads with no id', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ snippet: 'no id here' }] });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('missing id');
  });

  it('handles message with no parseable content', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ something: 'unexpected' });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('no parseable message');
  });

  it('handles { messages: [...] } response shape', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ messages: [{ id: 'm1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ message: { id: 'm1', subject: 'Msg', from: 'x@y.com' } });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.threadsFetched).toBe(1);
    expect(result.messagesNormalized).toBe(1);
  });

  it('handles message at top level (no wrapper)', () => {
    const d = mockDeps({
      execGog: (args) => {
        if (args.includes('list')) {
          return JSON.stringify({ threads: [{ id: 't1' }] });
        }
        if (args.includes('get')) {
          return JSON.stringify({ id: 't1', subject: 'Direct', from: 'd@e.com' });
        }
        return '{}';
      },
    });
    const result = runGogGmailSync(['--label', 'sent'], d);
    expect(result.messagesNormalized).toBe(1);
  });
});
