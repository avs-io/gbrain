/**
 * test-gbrain-daily-validator.mjs
 * ─────────────────────────────────────────────────────────────────
 * Acceptance test for gbrain-daily-validator.mjs
 *
 * Tests:
 *   1. Validator runs without errors (exit 0 or 2 for clean run)
 *   2. Validator outputs a validation report with expected structure
 *   3. PII violation detection works (test page with known PII → flagged)
 *   4. Clean page passes validation
 *
 * Run: node test-gbrain-daily-validator.mjs [--verbose]
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = resolve(__dirname, 'gbrain-daily-validator.mjs');

// ── Test helpers ───────────────────────────────────────────────────────────────

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function pass(msg) {
  testsRun++;
  testsPassed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  testsRun++;
  testsFailed++;
  console.error(`  ✗ ${msg}`);
}

function assert(condition, msg) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

function runValidator() {
  const result = spawnSync('node', [VALIDATOR], {
    encoding: 'utf8',
    timeout: 60_000,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message || null,
  };
}

function loadLatestReport() {
  const files = require('child_process').execSync(
    `ls -t ${__dirname}/validation-report-*.json 2>/dev/null | head -1`,
    { encoding: 'utf8' }
  ).trim();
  if (!files) return null;
  try {
    return JSON.parse(readFileSync(files, 'utf8'));
  } catch {
    return null;
  }
}

function cleanupTestReports() {
  try {
    const files = require('child_process').execSync(
      `ls ${__dirname}/validation-report-*.json 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean);
    for (const f of files) {
      try { unlinkSync(f); } catch {}
    }
  } catch {}
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CLEAN_PAGE = `---
title: "IndiaAI GPU tender timing signal"
type: claim
privacy_tier: P3_PUBLIC
created_by: hermes
created_at: ${new Date().toISOString()}
source_refs: ["search:IndiaAI Mission GPU tender 2026"]
status: active
---

# IndiaAI GPU Tender Timing Signal

IndiaAI's sovereign AI compute procurement (GPU tender closing Q2 2026)
creates a narrow window for Sarvam AI to embed inference infrastructure
before MeitY locks in a vendor.

## Evidence
- IndiaAI GPU tender deadline: Q2 2026
- MeitY compute procurement policy: active

## Implications
Timing-relevant for infrastructure partnership discussions expected Q2-Q3 2026.
`;

const PII_PAGE = `---
title: "Test PII page"
type: concept
privacy_tier: P3_PUBLIC
created_by: hermes
created_at: ${new Date().toISOString()}
source_refs: ["test"]
---

# Test PII Page

Contact: alice.sharma@example.com, phone: 9876543210
Aadhaar: 1234 5678 9012
`;

const FORBIDDEN_PAGE = `---
title: "Test forbidden content"
type: concept
privacy_tier: P3_PUBLIC
created_by: hermes
created_at: ${new Date().toISOString()}
source_refs: ["test"]
---

# Test Forbidden Content

Raw transcript from meeting with Sanjay:
"Hey, let's discuss the bank account details. The balance is 5000000."
`;

const NO_SOURCE_PAGE = `---
title: "No source attribution"
type: claim
privacy_tier: P3_PUBLIC
created_by: hermes
created_at: ${new Date().toISOString()}
status: active
---

# No Source Attribution

This claim has no evidence references and should fail the source attribution check.
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

function testValidatorRunsWithoutErrors() {
  console.log('\nTest 1: Validator runs without errors');
  const result = runValidator();

  // Exit codes: 0 = clean, 2 = issues found, 1 = error
  assert(
    [0, 2].includes(result.status),
    `Validator exited with status ${result.status} (expected 0 or 2)`
  );
  assert(!result.error, `Validator threw error: ${result.error}`);
}

function testValidatorOutputsReport() {
  console.log('\nTest 2: Validator outputs a validation report');
  const result = runValidator();
  if (result.status === 1) {
    fail('Validator failed to run (exit 1)');
    return;
  }

  const report = loadLatestReport();
  assert(report !== null, 'Report file was created');
  assert(typeof report.timestamp === 'string', 'Report has timestamp');
  assert(typeof report.pages_checked === 'number', 'Report has pages_checked');
  assert(['pages_clean', 'pages_with_issues', 'pages_checked'].every(k => k in report),
    'Report has required fields: pages_checked, pages_clean, pages_with_issues');
  assert(Array.isArray(report.summaries), 'Report has summaries array');
}

function testPiiDetection() {
  console.log('\nTest 3: PII detection works');
  // Write a test page with PII
  const testSlug = 'wiki/hermes/test-pii-page-' + Date.now();
  const tmpFile = '/tmp/gbrain-test-pii.md';
  writeFileSync(tmpFile, PII_PAGE);

  const putResult = spawnSync('gbrain', ['put', testSlug], {
    input: PII_PAGE,
    encoding: 'utf8',
    timeout: 15_000,
  });

  if (putResult.status !== 0) {
    fail(`Could not write test PII page (gbrain put failed): ${putResult.stderr}`);
    try { unlinkSync(tmpFile); } catch {}
    return;
  }

  const result = runValidator();
  const report = loadLatestReport();

  const piiPage = report?.issues_by_page?.find(p => p.slug === testSlug);
  const hasPiiIssue = piiPage?.issues?.some(i => i.check === 'pii_leak');

  assert(hasPiiIssue, 'PII page was flagged (email + phone + aadhaar detected)');

  // Cleanup
  try {
    spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 });
  } catch {}
  try { unlinkSync(tmpFile); } catch {}
}

function testForbiddenContentDetection() {
  console.log('\nTest 4: Forbidden content detection works');
  const testSlug = 'wiki/hermes/test-forbidden-' + Date.now();

  const putResult = spawnSync('gbrain', ['put', testSlug], {
    input: FORBIDDEN_PAGE,
    encoding: 'utf8',
    timeout: 15_000,
  });

  if (putResult.status !== 0) {
    fail(`Could not write test forbidden page: ${putResult.stderr}`);
    try { spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 }); } catch {}
    return;
  }

  const result = runValidator();
  const report = loadLatestReport();

  const forbiddenPage = report?.issues_by_page?.find(p => p.slug === testSlug);
  const hasForbiddenIssue = forbiddenPage?.issues?.some(i => i.check === 'forbidden_content');

  assert(hasForbiddenIssue, 'Forbidden content (raw transcript) was flagged');

  try {
    spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 });
  } catch {}
}

function testSourceAttributionCheck() {
  console.log('\nTest 5: Source attribution check works');
  const testSlug = 'wiki/hermes/test-no-source-' + Date.now();

  const putResult = spawnSync('gbrain', ['put', testSlug], {
    input: NO_SOURCE_PAGE,
    encoding: 'utf8',
    timeout: 15_000,
  });

  if (putResult.status !== 0) {
    fail(`Could not write test page: ${putResult.stderr}`);
    try { spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 }); } catch {}
    return;
  }

  const result = runValidator();
  const report = loadLatestReport();

  const noSourcePage = report?.issues_by_page?.find(p => p.slug === testSlug);
  const hasSourceIssue = noSourcePage?.issues?.some(i => i.check === 'source_attribution');

  assert(hasSourceIssue, 'Page without source attribution was flagged');

  try {
    spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 });
  } catch {}
}

function testCleanPagePasses() {
  console.log('\nTest 6: Clean page passes validation');
  const testSlug = 'wiki/hermes/test-clean-' + Date.now();

  const putResult = spawnSync('gbrain', ['put', testSlug], {
    input: CLEAN_PAGE,
    encoding: 'utf8',
    timeout: 15_000,
  });

  if (putResult.status !== 0) {
    fail(`Could not write clean test page: ${putResult.stderr}`);
    try { spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 }); } catch {}
    return;
  }

  const result = runValidator();
  const report = loadLatestReport();

  const cleanPage = report?.issues_by_page?.find(p => p.slug === testSlug);

  // Clean page should NOT be in issues_by_page, OR should have no critical issues
  const isClean = !cleanPage || !cleanPage.issues?.some(i => i.severity === 'critical');
  assert(isClean, 'Clean page was not flagged (or only non-critical issues)');

  try {
    spawnSync('gbrain', ['delete', testSlug], { timeout: 10_000 });
  } catch {}
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const verbose = process.argv.includes('--verbose');
  console.log('═'.repeat(60));
  console.log('GBrain Daily Validator — Acceptance Tests');
  console.log('═'.repeat(60));

  // Clean up any old test reports first
  cleanupTestReports();

  testValidatorRunsWithoutErrors();
  testValidatorOutputsReport();
  testPiiDetection();
  testForbiddenContentDetection();
  testSourceAttributionCheck();
  testCleanPagePasses();

  console.log('\n' + '─'.repeat(60));
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed, ${testsRun} total`);

  if (verbose) {
    const report = loadLatestReport();
    if (report) {
      console.log('\nLatest report summary:');
      console.log(JSON.stringify({
        pages_checked: report.pages_checked,
        pages_clean: report.pages_clean,
        pages_with_issues: report.pages_with_issues,
        critical_issues: report.critical_issues,
      }, null, 2));
    }
  }

  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});