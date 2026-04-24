import matter from 'gray-matter';
import { ParsedMarkdown } from './types';

// Upstream validation types (HEAD)
export type ParseValidationCode =
  | 'MISSING_OPEN'
  | 'MISSING_CLOSE'
  | 'YAML_PARSE'
  | 'SLUG_MISMATCH'
  | 'NULL_BYTES'
  | 'NESTED_QUOTES'
  | 'EMPTY_FRONTMATTER';

export interface ParseValidationError {
  code: ParseValidationCode;
  message: string;
  line?: number;
}

export interface ParseOpts {
  /** When true, errors[] is populated. Existing callers unaffected. */
  validate?: boolean;
  /** When validate is true and frontmatter has a `slug:` field that doesn't
   *  match expectedSlug, emits SLUG_MISMATCH. */
  expectedSlug?: string;
}

// Our resilient frontmatter parsing (avs/ollama-embedding branch)
function parseFrontmatterResilient(content: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(content);
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  } catch (error) {
    const repaired = repairQuotedTitleFrontmatter(content);
    if (repaired === content) throw error;
    const parsed = matter(repaired);
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  }
}

function repairQuotedTitleFrontmatter(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return content;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return content;

  const frontmatter = lines.slice(0, end + 1);
  let changed = false;
  const repaired = frontmatter.map((line, index) => {
    if (index === 0 || index === frontmatter.length - 1) return line;
    const match = line.match(/^(title:\s*)"(.*)"\s*$/);
    if (!match) return line;
    const value = match[2] ?? '';
    if (!value.includes('"')) return line;
    changed = true;
    return `${match[1]}'${value.replace(/'/g, "''")}'`;
  });

  if (!changed) return content;
  return [...repaired, ...lines.slice(end + 1)].join('\n');
}

// Upstream validation helpers (collectValidationErrors)
function collectValidationErrors(
  content: string,
  errors: ParseValidationError[],
  opts: { yamlParseError?: Error | null; expectedSlug?: string; parsedFrontmatter?: Record<string, unknown> },
): void {
  const { yamlParseError, expectedSlug, parsedFrontmatter } = opts;

  // Check for missing frontmatter delimiters
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    errors.push({ code: 'MISSING_OPEN', message: 'Missing frontmatter opening ---' });
    return;
  }

  // Find closing delimiter
  const firstLine = trimmed.indexOf('\n', 3);
  if (firstLine === -1) {
    errors.push({ code: 'MISSING_CLOSE', message: 'Missing frontmatter closing ---' });
    return;
  }

  const closeIdx = trimmed.indexOf('---', firstLine + 1);
  if (closeIdx === -1) {
    errors.push({ code: 'MISSING_CLOSE', message: 'Missing frontmatter closing ---' });
    return;
  }

  // Check for null bytes
  if (content.includes('\0')) {
    errors.push({ code: 'NULL_BYTES', message: 'Frontmatter contains null bytes' });
  }

  // Check for nested quotes in title
  const fmSection = trimmed.slice(3, closeIdx);
  const titleMatch = fmSection.match(/^title:\s*"(.*)"$/m);
  if (titleMatch && titleMatch[1].includes('"')) {
    errors.push({ code: 'NESTED_QUOTES', message: 'Title contains nested quotes' });
  }

  // Check for empty frontmatter
  const nonEmptyKeys = Object.keys(parsedFrontmatter ?? {}).filter(
    k => k !== 'title' && k !== 'date' && k !== 'tags' && k !== 'description',
  );
  if (nonEmptyKeys.length === 0 && Object.keys(parsedFrontmatter ?? {}).length === 0) {
    // Only flag if there's actual content that looks like it should have frontmatter
    const body = trimmed.slice(closeIdx + 3);
    if (body.trim().length > 0) {
      errors.push({ code: 'EMPTY_FRONTMATTER', message: 'Frontmatter is empty but body has content' });
    }
  }

  // Check slug mismatch
  if (opts.validate && expectedSlug) {
    const slug = (parsedFrontmatter?.slug as string) ?? '';
    if (slug && slug !== expectedSlug) {
      errors.push({ code: 'SLUG_MISMATCH', message: `Slug '${slug}' doesn't match expected '${expectedSlug}'` });
    }
  }
}

// Main parse function: uses our resilient parsing, falls back to upstream validation
export function parseMarkdown(
  content: string,
  filePath?: string,
  opts?: ParseOpts,
): ParsedMarkdown {
  const errors: ParseValidationError[] = [];

  let frontmatter: Record<string, unknown>;
  let body: string;

  try {
    // Use our resilient parsing first
    const { data, content: parsedBody } = parseFrontmatterResilient(content);
    frontmatter = data;
    body = parsedBody;
  } catch {
    // Fallback: raw matter parse (upstream behavior)
    const parsed = matter(content);
    frontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content ?? content;
  }

  // Run validation if requested
  if (opts?.validate) {
    collectValidationErrors(content, errors, {
      yamlParseError: null,
      expectedSlug: opts.expectedSlug,
      parsedFrontmatter: frontmatter,
    });
  }

  return {
    frontmatter,
    body,
    errors,
    filePath,
  } as ParsedMarkdown;
}
