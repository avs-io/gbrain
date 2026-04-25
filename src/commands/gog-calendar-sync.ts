/**
 * gbrain gog-calendar-sync — thin Google Calendar connector MVP.
 *
 * Shells out to the `gog` CLI (not Google API clients) to fetch calendars
 * and events, archives raw JSON, and normalizes event records.
 *
 * Usage:
 *   gbrain gog-calendar-sync [--date YYYY-MM-DD] [--calendar <id>] [--dry-run]
 *
 * Output layout (relative to gbrain root):
 *   raw/sources/archive/calendar-gog/<date>/
 *     calendars.json              — output of `gog calendar calendars --json`
 *     events-<calendarSlug>/
 *       events.json               — output of `gog calendar events <id> --json`
 *   raw/sources/events/calendar-gog/<date>/
 *     <slug>.md                   — normalized event record per event
 *
 * Does NOT access live Google data when tests run (inject mock deps).
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// ── gog binary ──────────────────────────────────────────────────
const GOG_BIN = process.env.GOG_BIN || 'gog';

// ── Root dir (ESM-safe, uses import.meta.url) ──────────────────
// Two levels up from src/commands/ → project root
const GBRAIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── Injectable deps (for testing without module-level patching) ─

export interface GogSyncDeps {
  execGog(args: string[]): string;      // runs gog with args, returns stdout JSON
  writeFile(path: string, data: string): void;
  mkdir(path: string): void;
  rootDir: string;                       // override project root
}

function defaultDeps(): GogSyncDeps {
  return {
    execGog: (args) => execFileSync(GOG_BIN, args, { encoding: 'utf8' }),
    writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    rootDir: GBRAIN_ROOT,
  };
}

// ── Types ───────────────────────────────────────────────────────

interface GogCalendarsResponse {
  calendars?: Array<{
    id: string;
    summary: string;
    accessRole?: string;
    timeZone?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

interface GogEventsResponse {
  events?: Array<{
    id: string;
    summary: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    description?: string;
    location?: string;
    status?: string;
    htmlLink?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface SyncResult {
  calendarsFetched: number;
  eventsFetched: number;
  eventsNormalized: number;
  errors: string[];
}

// ── Helpers ─────────────────────────────────────────────────────

function slugifyCalendarId(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'default';
}

function slugifyEventId(id: string): string {
  const slug = id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return 'evt-' + (slug || 'default');
}

// ── Core logic ──────────────────────────────────────────────────

export function runGogCalendarSync(args: string[], deps?: Partial<GogSyncDeps>): SyncResult {
  const d = { ...defaultDeps(), ...deps };
  const today = new Date().toISOString().slice(0, 10);

  let targetDate = today;
  let targetCalendar: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--date' && args[i + 1]) {
      targetDate = args[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw new Error(`Invalid date format: ${targetDate}. Expected YYYY-MM-DD.`);
      }
    } else if (a === '--calendar' && args[i + 1]) {
      targetCalendar = args[++i];
    } else if (a === '--dry-run') {
      dryRun = true;
    }
  }

  const archiveBase = join(d.rootDir, 'raw', 'sources', 'archive', 'calendar-gog', targetDate);
  const eventsBase = join(d.rootDir, 'raw', 'sources', 'events', 'calendar-gog', targetDate);

  const result: SyncResult = {
    calendarsFetched: 0,
    eventsFetched: 0,
    eventsNormalized: 0,
    errors: [],
  };

  // ── Step 1: Fetch calendars ───────────────────────────────────

  let calendarsResp: GogCalendarsResponse;
  try {
    const output = d.execGog(['calendar', 'calendars', '--json']);
    calendarsResp = JSON.parse(output) as GogCalendarsResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`Failed to fetch calendars: ${msg}`);
    console.error(`Error fetching calendars: ${msg}`);
    return result;
  }

  const calendars = calendarsResp.calendars || [];
  result.calendarsFetched = calendars.length;

  if (!dryRun) {
    d.mkdir(archiveBase);
    d.writeFile(join(archiveBase, 'calendars.json'), JSON.stringify(calendarsResp, null, 2));
    console.log(`Archived ${calendars.length} calendars → ${join(archiveBase, 'calendars.json')}`);
  } else {
    console.log(`[dry-run] would archive ${calendars.length} calendars`);
  }

  // ── Step 2: Fetch events per calendar ─────────────────────────

  const calendarsToSync = targetCalendar
    ? calendars.filter(c => c.id === targetCalendar)
    : calendars;

  if (calendarsToSync.length === 0 && targetCalendar) {
    result.errors.push(`Calendar "${targetCalendar}" not found.`);
    console.error(`Calendar "${targetCalendar}" not found.`);
    return result;
  }

  for (const cal of calendarsToSync) {
    let eventsResp: GogEventsResponse;
    try {
      const output = d.execGog(['calendar', 'events', cal.id, '--json']);
      eventsResp = JSON.parse(output) as GogEventsResponse;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`Failed to fetch events for calendar "${cal.id}": ${msg}`);
      console.error(`Error fetching events for "${cal.id}": ${msg}`);
      continue;
    }

    const events = eventsResp.events || [];
    result.eventsFetched += events.length;

    if (!dryRun) {
      const calArchiveDir = join(archiveBase, `events-${slugifyCalendarId(cal.id)}`);
      d.mkdir(calArchiveDir);
      d.writeFile(join(calArchiveDir, 'events.json'), JSON.stringify(eventsResp, null, 2));
      console.log(`  Archived ${events.length} events from "${cal.summary}" → ${calArchiveDir}/events.json`);
    } else {
      console.log(`  [dry-run] would archive ${events.length} events from "${cal.summary}"`);
    }

    // ── Step 3: Normalize events ──────────────────────────────────

    for (const evt of events) {
      const startDateTime = evt.start?.dateTime || evt.start?.date || '';
      const endDateTime = evt.end?.dateTime || evt.end?.date || '';
      const timeZone = evt.start?.timeZone || cal.timeZone;

      if (!dryRun) {
        d.mkdir(eventsBase);
        const evtSlug = slugifyEventId(evt.id || '');
        const mdPath = join(eventsBase, `${evtSlug}.md`);

        const lines: string[] = [
          `# ${evt.summary || '(no title)'}`,
          '',
          `**Calendar:** ${cal.summary}`,
          `**Start:** ${startDateTime}`,
          `**End:** ${endDateTime}`,
        ];
        if (timeZone) lines.push(`**Timezone:** ${timeZone}`);
        if (evt.location) lines.push(`**Location:** ${evt.location}`);
        if (evt.status) lines.push(`**Status:** ${evt.status}`);
        if (evt.htmlLink) lines.push('', `[View in Google Calendar](${evt.htmlLink})`);
        if (evt.description) lines.push('', '---', '', evt.description);
        lines.push('', '---', `*Source: calendar-gog | Imported: ${targetDate}*`, '');

        d.writeFile(mdPath, lines.join('\n'));
        result.eventsNormalized++;
      }
    }
  }

  console.log(
    `\nSync complete: ${result.calendarsFetched} calendars, ` +
    `${result.eventsFetched} events, ${result.eventsNormalized} normalized${dryRun ? ' (dry-run)' : ''}`,
  );

  if (result.errors.length > 0) {
    console.error(`Errors (${result.errors.length}):`);
    for (const err of result.errors) console.error(`  - ${err}`);
  }

  return result;
}

// ── CLI entry ───────────────────────────────────────────────────

const USAGE = `
Usage: gbrain gog-calendar-sync [options]

Sync Google Calendar events via the \`gog\` CLI. Archives raw JSON and
normalizes events to markdown under raw/sources/.

Options:
  --date YYYY-MM-DD   Date partition for archive paths (default: today)
  --calendar <id>     Only sync this calendar ID (default: all calendars)
  --dry-run           Print what would happen without writing any files
  --help              Show this help message

Output layout:
  raw/sources/archive/calendar-gog/<date>/
    calendars.json
    events-<slug>/events.json
  raw/sources/events/calendar-gog/<date>/
    <slug>.md

Requires: gog CLI in PATH (or set GOG_BIN env var to the binary path).
`.trimStart();

export async function runGogCalendarSyncCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
    return; // guard for test environments where process.exit is mocked
  }
  try {
    runGogCalendarSync(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`gog-calendar-sync failed: ${msg}`);
    process.exit(1);
  }
}
