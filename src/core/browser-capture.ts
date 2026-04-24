import type { PageType } from './types.ts';
import type { ParsedMarkdown } from './markdown.ts';
import { slugifyPath } from './sync.ts';

export interface BrowserCaptureEvent {
  version?: string;
  event_type: string;
  session_id?: string;
  timestamp?: string;
  url?: string;
  title?: string;
  text?: string;
  content?: string;
  tags?: string[];
  slug?: string;
  [key: string]: unknown;
}

/**
 * Parse a browser_capture_jsonl_v1 file (one browser_capture_event_v1 JSON per line)
 * into the standard ParsedMarkdown shape for ingestion.
 *
 * Supported event_types:
 *   session_start   — session metadata (title, url, tags, slug)
 *   page_content    — full page text capture
 *   text_selection  — user-highlighted text (stored as blockquote)
 *   annotation      — user note attached to a page
 *   transcript      — dictated or spoken text
 *   navigation      — url change (timeline only, no compiled_truth)
 *
 * Unknown event types are silently skipped so future writers stay forward-compatible.
 */
export function parseBrowserCaptureJsonl(content: string, filePath?: string): ParsedMarkdown {
  const lines = content.split('\n').filter(l => l.trim());

  let title = '';
  let slug = '';
  const tags: string[] = [];
  const sections: string[] = [];
  const timelineEntries: string[] = [];
  const frontmatter: Record<string, unknown> = {};
  const type: PageType = 'source';
  let sessionId = '';
  let firstUrl = '';

  for (const line of lines) {
    let event: BrowserCaptureEvent;
    try {
      event = JSON.parse(line) as BrowserCaptureEvent;
    } catch {
      continue; // skip malformed lines — resilience over strictness
    }

    if (!event.event_type) continue;

    if (event.session_id && !sessionId) sessionId = event.session_id;
    if (event.url && !firstUrl) firstUrl = event.url;

    const ts = event.timestamp ? formatTimestamp(event.timestamp) : '';

    switch (event.event_type) {
      case 'session_start': {
        if (event.title && !title) title = event.title;
        if (event.slug && !slug) slug = event.slug;
        if (Array.isArray(event.tags)) {
          for (const t of event.tags) tags.push(String(t));
        }
        if (event.url) {
          frontmatter.source_url = event.url;
          timelineEntries.push(`${ts}: Session started — ${event.url}`);
        }
        break;
      }

      case 'page_content': {
        if (event.content) {
          const header = event.title
            ? `## ${event.title}\n\nSource: ${event.url || ''}\n\n`
            : (event.url ? `Source: ${event.url}\n\n` : '');
          sections.push(`${header}${event.content.trim()}`);
          if (event.title && !title) title = event.title;
        }
        if (event.url) {
          const label = event.title ? `${event.title} — ${event.url}` : event.url;
          timelineEntries.push(`${ts}: Visited — ${label}`);
        }
        break;
      }

      case 'text_selection': {
        if (event.text) {
          const attribution = event.url ? `\n\n— ${event.url}` : '';
          sections.push(`> ${event.text.trim()}${attribution}`);
        }
        break;
      }

      case 'annotation': {
        if (event.text) {
          sections.push(`**Note:** ${event.text.trim()}`);
        }
        break;
      }

      case 'transcript': {
        if (event.text) {
          sections.push(event.text.trim());
        }
        break;
      }

      case 'navigation': {
        if (event.url) {
          timelineEntries.push(`${ts}: Navigated to — ${event.url}`);
        }
        break;
      }
      // Unknown event types are intentionally skipped for forward-compatibility
    }
  }

  if (!slug) {
    slug = filePath
      ? slugifyPath(filePath.replace(/\.jsonl$/i, '.md'))
      : `browser/capture/${sessionId || 'untitled'}`;
  }
  if (!title) {
    title = filePath
      ? inferTitleFromPath(filePath)
      : sessionId
        ? `Browser Session ${sessionId}`
        : 'Browser Capture';
  }

  if (sessionId) frontmatter.session_id = sessionId;
  if (firstUrl && !frontmatter.source_url) frontmatter.source_url = firstUrl;

  return {
    frontmatter,
    compiled_truth: sections.join('\n\n').trim(),
    timeline: timelineEntries.join('\n').trim(),
    slug,
    type,
    title,
    tags,
  };
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return ts;
  }
}

function inferTitleFromPath(filePath: string): string {
  const base = filePath.split('/').pop() || 'untitled';
  return base
    .replace(/\.jsonl$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
