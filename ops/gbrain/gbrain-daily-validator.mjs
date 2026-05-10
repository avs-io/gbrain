/**
 * gbrain-daily-validator.mjs
 * ─────────────────────────────────────────────────────────────────
 * OpenClaw daily validation of GBrain write-back hygiene.
 *
 * Runs daily via cron: `node ops/gbrain/gbrain-daily-validator.mjs`
 *
 * Checks (last 24h of pages):
 *   1. Privacy hygiene — no P0_PRIVATE/P1_SENSITIVE raw leaks
 *   2. Page quality — frontmatter present, slug namespace correct
 *   3. Source attribution — evidence refs present
 *   4. No forbidden content — raw transcripts, session logs, financial IDs
 *
 * Reports to: ops/gbrain/validation-report-YYYY-MM-DD.json
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..'); // gbrain workspace root
const REPORT_DIR = resolve(__dirname);

// ── Privacy violation patterns ────────────────────────────────────────────────

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  phone: /\b(\+91[\s\-]?)?(\d{10}|\d{5}[\s\-]\d{5})\b/,
  aadhaar: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,
  ssn: /\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/,
  credit_card: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,
  bank_account: /\b\d{9,18}\b/,
  api_key: /\b(AKEY|api[_-]?key|secret)[_\-]?[A-Za-z0-9]{16,}\b/i,
  password: /\b(password|pwd|passwd)[\s:=]+\S+\b/i,
};

const FORBIDDEN_CONTENT = {
  raw_transcript: /transcript|conversation log|session log|full (email|message) thread/i,
  financial_detail: /bank account|credit card|balance.*\d{4,}|net worth|salary.*\d+/i,
  family_pii: /father|mother|spouse|children.*name|home address/i,
};

// ── Slug namespace rules ───────────────────────────────────────────────────────

const ALLOWED_NAMESPACES = [
  'wiki/hermes/',
  'wiki/agents/',
  'wiki/projects/',
  'wiki/concepts/',
  'wiki/claims/',
  'wiki/open-loops/',
  'wiki/taste-signals/',
  'sources/imports/',  // gmail/imported email archives — PII handled via frontmatter source metadata
  'working/email/',        // staging: email-derived proposals before promotion
  'working/ledger-proposal/', // staging: ledger proposals before promotion
];

const TRUSTED_PAGES = [
  // Trusted pages that should never be written by Hermes
  'wiki/trusted/',
  'wiki/users/',
  'wiki/personal/',
];

// Namespaces where PII and forbidden-content checks are skipped because
// content is a raw import archive with its own provenance metadata.
const SKIP_PII_NAMESPACES = [
  'sources/imports/',  // gmail/imported email archives — trust the source_* frontmatter fields
];

// Namespaces where source_attribution check is skipped (source type pages
// carry attribution in their frontmatter source_* fields instead).
const SKIP_SOURCE_ATTR_NAMESPACES = [
  'sources/imports/',  // source pages use source_id / source_type / source_account for attribution
  'working/email/',        // staging: source attribution added on promotion to wiki/
  'working/ledger-proposal/', // staging: source attribution added on promotion to wiki/
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function runGbrain(args, timeout = 30_000) {
  const fullArgs = ['gbrain', ...args];
  const result = spawnSync(fullArgs[0], fullArgs.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    error: result.error?.message || null,
  };
}

export function getRecentPages(sinceIso) {
  // Get pages updated since ISO timestamp (last 24h)
  // Use MCP operation via `gbrain call` for structured JSON output
  const r = runGbrain(['call', 'list_pages', '{"limit": 1000}']);
  if (r.status !== 0 || !r.stdout) {
    // Fallback: try plain list and parse (not ideal but works)
    const listR = runGbrain(['list', '--limit', '1000']);
    if (listR.status !== 0) throw new Error(`gbrain list failed: ${listR.stderr || listR.error}`);
    return parsePlainListOutput(listR.stdout, sinceIso);
  }

  let pages;
  try {
    pages = JSON.parse(r.stdout);
  } catch {
    throw new Error(`Failed to parse list_pages JSON: ${r.stdout.slice(0, 200)}`);
  }

  if (!Array.isArray(pages)) return [];

  const since = new Date(sinceIso).getTime();
  return pages.filter(p => {
    const updated = new Date(p.updated_at).getTime();
    return updated >= since;
  });
}

/** Parse gbrain list plain-text output into structured page objects. */
function parsePlainListOutput(stdout, sinceIso) {
  if (!stdout) return [];
  const lines = stdout.split('\n').filter(l => l.trim());
  const since = new Date(sinceIso).getTime();

  return lines.map(line => {
    // Format: slug\ttype\tdate\ttitle
    const parts = line.split('\t');
    return {
      slug: parts[0] || '',
      type: parts[1] || 'concept',
      updated_at: parts[2] || '',
      title: parts[3] || '',
    };
  }).filter(p => {
    if (!p.updated_at) return false;
    const d = new Date(p.updated_at).getTime();
    return !isNaN(d) && d >= since;
  });
}

export function getPageContent(slug) {
  const r = runGbrain(['get', slug]);
  if (r.status !== 0) return null;
  return r.stdout;
}

export function checkFrontmatter(content) {
  if (!content) return { ok: false, error: 'no content' };
  const hasFrontmatter = content.trim().startsWith('---');
  return {
    ok: hasFrontmatter,
    error: hasFrontmatter ? null : 'missing YAML frontmatter',
  };
}

export function checkSlugNamespace(slug) {
  const isTrusted = TRUSTED_PAGES.some(t => slug.startsWith(t));
  if (isTrusted) return { ok: true, warning: 'trusted namespace, skip Hermes check' };

  const allowed = ALLOWED_NAMESPACES.some(ns => slug.startsWith(ns));
  return {
    ok: allowed,
    error: allowed ? null : `slug not in allowed namespaces: ${ALLOWED_NAMESPACES.join(', ')}`,
  };
}

export function checkSourceAttribution(content, slug) {
  if (!content) return { ok: false, error: 'no content' };
  // Skip for namespaces that use frontmatter source_* fields for attribution
  if (SKIP_SOURCE_ATTR_NAMESPACES.some(ns => slug.startsWith(ns))) return { ok: true, skipped: true };
  const hasSourceRef = /source_refs:|evidence:|reference:|see also/i.test(content);
  return {
    ok: hasSourceRef,
    error: hasSourceRef ? null : 'missing source attribution (source_refs, evidence, or reference)',
  };
}

export function checkPiiLeaks(content, slug) {
  if (!content) return [];
  if (SKIP_PII_NAMESPACES.some(ns => slug.startsWith(ns))) return [];
  const leaks = [];

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    if (pattern.test(content)) {
      // Filter out obvious false positives
      const context = content.substring(0, 200);
      if (type === 'email' && /\btest@example|user@domain\.com\b/i.test(content)) continue;
      if (type === 'phone' && /\b\d{10}\b/.test(content) && !/\b[6-9]\d{9}\b/.test(content)) continue;
      leaks.push({ type, pattern: type, location: 'body' });
    }
  }

  return leaks;
}

export function checkForbiddenContent(content, slug) {
  if (!content) return [];
  if (SKIP_PII_NAMESPACES.some(ns => slug.startsWith(ns))) return [];
  const violations = [];

  for (const [type, pattern] of Object.entries(FORBIDDEN_CONTENT)) {
    if (pattern.test(content)) {
      violations.push({ type, pattern: type, location: 'body' });
    }
  }

  return violations;
}

export function validatePage(slug, content) {
  const frontmatter = checkFrontmatter(content);
  const slugNs = checkSlugNamespace(slug);
  const sourceAttr = checkSourceAttribution(content, slug);
  const piiLeaks = checkPiiLeaks(content, slug);
  const forbidden = checkForbiddenContent(content, slug);

  const ok = frontmatter.ok && slugNs.ok && sourceAttr.ok && piiLeaks.length === 0 && forbidden.length === 0;

  const issues = [];
  if (!frontmatter.ok) issues.push({ severity: 'error', check: 'frontmatter', message: frontmatter.error });
  if (!slugNs.ok) issues.push({ severity: 'error', check: 'slug_namespace', message: slugNs.error });
  if (slugNs.warning) issues.push({ severity: 'warning', check: 'slug_namespace', message: slugNs.warning });
  if (!sourceAttr.ok) issues.push({ severity: 'error', check: 'source_attribution', message: sourceAttr.error });
  if (piiLeaks.length > 0) issues.push({ severity: 'critical', check: 'pii_leak', message: `PII detected: ${piiLeaks.map(l => l.type).join(', ')}` });
  if (forbidden.length > 0) issues.push({ severity: 'critical', check: 'forbidden_content', message: `Forbidden content: ${forbidden.map(f => f.type).join(', ')}` });

  return { ok, issues };
}

// ── Main validation ────────────────────────────────────────────────────────────

export async function runValidation() {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const report = {
    timestamp: now.toISOString(),
    period: { from: since, to: now.toISOString() },
    pages_checked: 0,
    pages_clean: 0,
    pages_with_issues: 0,
    critical_issues: 0,
    summaries: [],
    issues_by_page: [],
  };

  let pages;
  try {
    pages = getRecentPages(since);
  } catch (err) {
    report.error = `Failed to get recent pages: ${err.message}`;
    return report;
  }

  report.pages_checked = pages.length;

  for (const page of pages) {
    const content = getPageContent(page.slug);
    const result = validatePage(page.slug, content);

    const pageReport = {
      slug: page.slug,
      type: page.type,
      title: page.title,
      updated_at: page.updated_at,
      ok: result.ok,
      issues: result.issues,
    };

    if (result.ok) {
      report.pages_clean++;
    } else {
      report.pages_with_issues++;
      report.issues_by_page.push(pageReport);
      if (result.issues.some(i => i.severity === 'critical')) {
        report.critical_issues++;
      }
    }

    report.summaries.push({
      slug: page.slug,
      ok: result.ok,
      issue_count: result.issues.length,
      critical: result.issues.some(i => i.severity === 'critical'),
    });
  }

  return report;
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runValidation();

  // Save JSON report
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const reportPath = resolve(REPORT_DIR, `validation-report-${dateStr}.json`);

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Console summary
  console.log(`\nGBrain Daily Validation Report — ${report.timestamp}`);
  console.log('─'.repeat(60));
  console.log(`Pages checked  : ${report.pages_checked}`);
  console.log(`Pages clean    : ${report.pages_clean}`);
  console.log(`Pages w/issues: ${report.pages_with_issues}`);
  console.log(`Critical issues: ${report.critical_issues}`);

  if (report.issues_by_page.length > 0) {
    console.log('\nIssues found:');
    for (const p of report.issues_by_page) {
      console.log(`\n  ${p.slug} [${p.type}]`);
      for (const issue of p.issues) {
        console.log(`    [${issue.severity.toUpperCase()}] ${issue.check}: ${issue.message}`);
      }
    }
  }

  console.log(`\nFull report: ${reportPath}`);

  if (report.error) {
    console.error(`\nValidation error: ${report.error}`);
    process.exit(1);
  }

  process.exit(report.critical_issues > 0 ? 2 : 0);
}