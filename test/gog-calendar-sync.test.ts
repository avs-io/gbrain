/**
 * Tests for gog-calendar-sync command.
 *
 * Strategy: inject mock deps (execGog, writeFile, mkdir, rootDir) directly into
 * runGogCalendarSync() so no live `gog` CLI or Google account is needed.
 * Source-level assertions verify ESM compat and shell-injection safety.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runGogCalendarSync, runGogCalendarSyncCommand, type GogSyncDeps } from '../src/commands/gog-calendar-sync.ts';

// ── Fixtures ──────────────────────────────────────────────────────

const TEST_CAL_ID_1 = 'primary@example.com';
const TEST_CAL_ID_2 = 'team@example.com';
const TEST_CAL_SUMMARY_1 = 'Primary Calendar';
const TEST_CAL_SUMMARY_2 = 'Team Calendar';

function makeCalendarsResponse() {
  return JSON.stringify({
    calendars: [
      {
        id: TEST_CAL_ID_1,
        summary: TEST_CAL_SUMMARY_1,
        accessRole: 'owner',
        timeZone: 'Asia/Kolkata',
      },
      {
        id: TEST_CAL_ID_2,
        summary: TEST_CAL_SUMMARY_2,
        accessRole: 'reader',
        timeZone: 'America/New_York',
      },
    ],
  });
}

function makeTimedEventsResponse() {
  return JSON.stringify({
    events: [
      {
        id: 'evt-timed-001',
        summary: 'Sprint Planning',
        start: { dateTime: '2026-04-27T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2026-04-27T11:00:00+05:30', timeZone: 'Asia/Kolkata' },
        description: 'Weekly sprint planning session',
        location: 'Conference Room A',
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=abc',
      },
    ],
  });
}

function makeAllDayEventsResponse() {
  return JSON.stringify({
    events: [
      {
        id: 'evt-allday-002',
        summary: 'Public Holiday',
        start: { date: '2026-04-27' },
        end: { date: '2026-04-28' },
        description: 'National holiday',
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/calendar/event?evt=xyz',
      },
    ],
  });
}

function makeEmptyEventsResponse() {
  return JSON.stringify({ events: [] });
}

// ── Dep helpers ───────────────────────────────────────────────────

function makeDeps(
  execGogImpl: (args: string[]) => string,
  opts?: { writeCalls?: Array<{ path: string; data: string }> },
): GogSyncDeps {
  return {
    execGog: execGogImpl,
    writeFile: (path, data) => { opts?.writeCalls?.push({ path, data }); },
    mkdir: () => {},
    rootDir: '/tmp/gbrain-test',
  };
}

const calOnlyExec = (args: string[]): string => {
  if (args.includes('calendars')) return makeCalendarsResponse();
  if (args.includes('events')) return makeEmptyEventsResponse();
  return '';
};

// ── Source path ───────────────────────────────────────────────────

const SRC_FILE = join(import.meta.dir, '../src/commands/gog-calendar-sync.ts');

// ── Test: ESM __dirname compatibility ─────────────────────────────

describe('ESM __dirname compatibility', () => {
  test('getGbrainRoot works in ESM (no __dirname)', () => {
    const src = readFileSync(SRC_FILE, 'utf-8');
    const usesDirname = /__dirname/.test(src);
    expect(usesDirname).toBe(false);
  });
});

// ── Test: command injection safety (source-level) ─────────────────

describe('command injection safety', () => {
  test('execSync uses array form, not template literal with user data', () => {
    const src = readFileSync(SRC_FILE, 'utf-8');
    // Disallow: execSync(`...${...id...}...`)
    const unsafePattern = /execSync\(`[^`]*\$\{[^}]*\.id[^}]*\}[^`]*`/;
    expect(unsafePattern.test(src)).toBe(false);
  });

  test('no execSync with template literal calendar events call', () => {
    const src = readFileSync(SRC_FILE, 'utf-8');
    const hasTemplateLiteralInjection = /execSync\(`gog calendar events\s+\$\{/.test(src);
    expect(hasTemplateLiteralInjection).toBe(false);
  });
});

// ── Test: --help support ──────────────────────────────────────────

describe('--help support', () => {
  test('runGogCalendarSyncCommand with --help prints usage and exits 0', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origExit = process.exit;
    let exitCode: number | null = null;

    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    process.exit = ((code: number) => { exitCode = code; }) as never;

    try {
      await runGogCalendarSyncCommand(['--help']);
    } finally {
      console.log = origLog;
      process.exit = origExit;
    }

    expect(exitCode).toBe(0);
    const combined = logs.join('\n');
    expect(combined).toMatch(/usage|gog-calendar-sync|--date|--calendar|--dry-run/i);
  });
});

// ── Test: dry-run does not write files ────────────────────────────

describe('dry-run behavior', () => {
  test('dry-run does not create any files on disk', () => {
    const writeCalls: Array<{ path: string; data: string }> = [];
    const deps = makeDeps(calOnlyExec, { writeCalls });

    runGogCalendarSync(['--dry-run'], deps);

    expect(writeCalls.length).toBe(0);
  });
});

// ── Test: markdown output ─────────────────────────────────────────

describe('markdown output', () => {
  test('timed event produces correct markdown', () => {
    const writeCalls: Array<{ path: string; data: string }> = [];

    runGogCalendarSync(['--date', '2026-04-27'], {
      execGog: (args) => {
        if (args.includes('calendars')) return makeCalendarsResponse();
        return makeTimedEventsResponse();
      },
      writeFile: (path, data) => writeCalls.push({ path, data }),
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    const mdFiles = writeCalls.filter(c => c.path.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);

    const timedMd = mdFiles.find(c => c.data.includes('Sprint Planning'));
    expect(timedMd).toBeDefined();
    expect(timedMd!.data).toContain('# Sprint Planning');
    expect(timedMd!.data).toContain('**Start:** 2026-04-27T10:00:00+05:30');
    expect(timedMd!.data).toContain('**End:** 2026-04-27T11:00:00+05:30');
    expect(timedMd!.data).toContain('**Timezone:** Asia/Kolkata');
    expect(timedMd!.data).toContain('**Location:** Conference Room A');
    expect(timedMd!.data).toContain('**Status:** confirmed');
    expect(timedMd!.data).toContain('[View in Google Calendar]');
    expect(timedMd!.data).toContain('Weekly sprint planning session');
    expect(timedMd!.data).toContain('Imported: 2026-04-27');
  });

  test('all-day event produces correct markdown (no time, just date)', () => {
    const writeCalls: Array<{ path: string; data: string }> = [];

    runGogCalendarSync(['--date', '2026-04-27'], {
      execGog: (args) => {
        if (args.includes('calendars')) return makeCalendarsResponse();
        return makeAllDayEventsResponse();
      },
      writeFile: (path, data) => writeCalls.push({ path, data }),
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    const mdFiles = writeCalls.filter(c => c.path.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);

    const alldayMd = mdFiles.find(c => c.data.includes('Public Holiday'));
    expect(alldayMd).toBeDefined();
    expect(alldayMd!.data).toContain('# Public Holiday');
    expect(alldayMd!.data).toContain('**Start:** 2026-04-27');
    expect(alldayMd!.data).toContain('**End:** 2026-04-28');
    expect(alldayMd!.data).not.toMatch(/Timezone.*National/);
    expect(alldayMd!.data).toContain('National holiday');
  });
});

// ── Test: invalid date handling ───────────────────────────────────

describe('invalid date handling', () => {
  test('throws on invalid date format', () => {
    const deps = makeDeps(calOnlyExec);
    expect(() => runGogCalendarSync(['--date', 'not-a-date'], deps)).toThrow(
      /Invalid date format/,
    );
  });

  test('accepts valid YYYY-MM-DD dates', () => {
    const deps = makeDeps(calOnlyExec);
    const result = runGogCalendarSync(['--date', '2026-12-31'], deps);
    expect(result.errors.length).toBe(0);
  });
});

// ── Test: unknown calendar handling ───────────────────────────────

describe('unknown calendar handling', () => {
  test('returns error when --calendar ID does not match any calendar', () => {
    const deps = makeDeps(calOnlyExec);
    const result = runGogCalendarSync(['--calendar', 'nonexistent@example.com'], deps);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found');
    expect(result.calendarsFetched).toBe(2);
    expect(result.eventsFetched).toBe(0);
    expect(result.eventsNormalized).toBe(0);
  });
});

// ── Test: slug collision handling ─────────────────────────────────

describe('slug collision handling', () => {
  test('different event IDs produce different slugs', () => {
    const writeCalls: Array<{ path: string; data: string }> = [];

    const multiEventResponse = JSON.stringify({
      events: [
        {
          id: 'unique-id-aaa-111',
          summary: 'Event A',
          start: { dateTime: '2026-04-27T10:00:00+05:30' },
          end: { dateTime: '2026-04-27T11:00:00+05:30' },
        },
        {
          id: 'unique-id-bbb-222',
          summary: 'Event B',
          start: { dateTime: '2026-04-27T14:00:00+05:30' },
          end: { dateTime: '2026-04-27T15:00:00+05:30' },
        },
      ],
    });

    runGogCalendarSync(['--date', '2026-04-27', '--calendar', TEST_CAL_ID_1], {
      execGog: (args) => {
        if (args.includes('calendars')) return makeCalendarsResponse();
        return multiEventResponse;
      },
      writeFile: (path, data) => writeCalls.push({ path, data }),
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    const mdFiles = writeCalls.filter(c => c.path.endsWith('.md'));
    expect(mdFiles.length).toBe(2);

    const slugs = mdFiles.map(c => {
      const parts = c.path.split('/');
      return parts[parts.length - 1];
    });
    expect(new Set(slugs).size).toBe(2);
  });
});

// ── Test: deterministic paths ─────────────────────────────────────

describe('deterministic paths', () => {
  test('archive and event paths are deterministic per date', () => {
    const writeCalls: Array<{ path: string }> = [];

    runGogCalendarSync(['--date', '2026-04-27'], {
      execGog: calOnlyExec,
      writeFile: (path) => writeCalls.push({ path }),
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    for (const call of writeCalls) {
      expect(call.path).toContain('calendar-gog');
      expect(call.path).toContain('2026-04-27');
    }
  });
});

// ── Test: --calendar filter ───────────────────────────────────────

describe('--calendar filter', () => {
  test('only fetches events for the specified calendar', () => {
    const execCalls: string[][] = [];

    runGogCalendarSync(['--calendar', TEST_CAL_ID_1], {
      execGog: (args) => {
        execCalls.push(args);
        if (args.includes('calendars')) return makeCalendarsResponse();
        return makeEmptyEventsResponse();
      },
      writeFile: () => {},
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    const eventCalls = execCalls.filter(a => a.includes('events'));
    expect(eventCalls.length).toBe(1);
    expect(eventCalls[0]).toContain(TEST_CAL_ID_1);
  });
});

// ── Test: SyncResult structure ────────────────────────────────────

describe('SyncResult structure', () => {
  test('returns correct structure with all fields', () => {
    const deps = makeDeps(calOnlyExec);
    const result = runGogCalendarSync([], deps);

    expect(result).toHaveProperty('calendarsFetched');
    expect(result).toHaveProperty('eventsFetched');
    expect(result).toHaveProperty('eventsNormalized');
    expect(result).toHaveProperty('errors');
    expect(typeof result.calendarsFetched).toBe('number');
    expect(typeof result.eventsFetched).toBe('number');
    expect(typeof result.eventsNormalized).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ── Test: default date (today) ────────────────────────────────────

describe('default date', () => {
  test('uses today when --date is not provided', () => {
    const writeCalls: Array<{ path: string }> = [];

    runGogCalendarSync([], {
      execGog: calOnlyExec,
      writeFile: (path) => writeCalls.push({ path }),
      mkdir: () => {},
      rootDir: '/tmp/gbrain-test',
    });

    const today = new Date().toISOString().slice(0, 10);
    for (const call of writeCalls) {
      expect(call.path).toContain(today);
    }
  });
});
