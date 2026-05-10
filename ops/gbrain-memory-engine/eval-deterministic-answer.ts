import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { AnswerEnvelope } from '../../src/core/answer/types.ts';
import type { RecallResult } from '../../src/core/evidence/recall.ts';

interface RemoveEvidenceCase {
  id: string;
  removeWindowIds: string[];
  expectedMissingSlots: string[];
  prohibitedRegex?: string[];
}

interface DeterministicAnswerFixture {
  id: string;
  query: string;
  recallJsonPath?: string;
  expectedShapeId: string;
  requiredSlots: string[];
  minClaimsBySlot: Record<string, number>;
  prohibitedRegex?: string[];
  removeEvidenceCases?: RemoveEvidenceCase[];
  metamorphic?: { shuffleStability?: boolean };
  recall?: RecallResult;
}

interface FixtureMetric {
  fixtureId: string;
  shapeId: string;
  status: AnswerEnvelope['status'];
  requiredSlotCoverage: number;
  claimCount: number;
  unsupportedClaimCount: number;
  citationIntegrity: number;
  invalidCitationCount: number;
  missingSlotPrecision: number;
  conflictHandling: 'pass' | 'not_exercised';
  shuffleStability: 'pass' | 'fail' | 'not_exercised';
  hardcodeGuard: 'pass' | 'fail';
  errors: string[];
}

function fixtureDir(): string {
  return join(process.cwd(), 'test/fixtures/answer-synthesis');
}

function loadFixtures(): DeterministicAnswerFixture[] {
  return readdirSync(fixtureDir())
    .filter(name => name.endsWith('.json'))
    .filter(name => !name.endsWith('.recall.json'))
    .sort()
    .map(name => JSON.parse(readFileSync(join(fixtureDir(), name), 'utf8')) as DeterministicAnswerFixture);
}

function loadRecallForFixture(fixture: DeterministicAnswerFixture): RecallResult {
  if (fixture.recall) return fixture.recall;
  if (fixture.recallJsonPath) {
    const path = fixture.recallJsonPath.startsWith('gbrain/')
      ? fixture.recallJsonPath.slice('gbrain/'.length)
      : fixture.recallJsonPath;
    return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as RecallResult;
  }
  throw new Error(`fixture ${fixture.id} missing recall or recallJsonPath`);
}

function normalizeAnswerForStability(envelope: AnswerEnvelope): string {
  return JSON.stringify(envelope.claims.map(claim => ({
    kind: claim.kind,
    slotId: claim.slotId,
    text: claim.text,
    citations: claim.citations.map(citation => citation.id).sort(),
  })));
}

function countSupportedRequiredSlots(envelope: AnswerEnvelope, requiredSlots: string[]): number {
  return requiredSlots.filter(slotId => envelope.claims.some(claim => claim.slotId === slotId && (!claim.factual || claim.citations.length > 0))).length;
}

function regexErrors(envelope: AnswerEnvelope, regexes: string[] = [], prefix = 'prohibitedRegex'): string[] {
  const haystack = `${envelope.answer}\n${JSON.stringify(envelope.claims)}`;
  return regexes
    .filter(pattern => new RegExp(pattern, 'i').test(haystack))
    .map(pattern => `${prefix} matched: ${pattern}`);
}

function invalidCitationCount(envelope: AnswerEnvelope): number {
  return envelope.validation.errors.filter(error => /citation|support/i.test(error)).length;
}

function evaluateFixture(fixture: DeterministicAnswerFixture): FixtureMetric {
  const recall = { ...loadRecallForFixture(fixture), query: fixture.query } as RecallResult;
  const envelope = buildDeterministicAnswerEnvelope(recall, { maxEvidence: 8, maxQuoteChars: 520 });
  const errors: string[] = [];

  if (envelope.shape !== fixture.expectedShapeId) errors.push(`shape expected ${fixture.expectedShapeId}, got ${envelope.shape}`);
  if (!envelope.validation.ok) errors.push(...envelope.validation.errors);

  for (const [slotId, minCount] of Object.entries(fixture.minClaimsBySlot)) {
    const count = envelope.claims.filter(claim => claim.slotId === slotId && claim.factual && claim.citations.length > 0).length;
    if (count < minCount) errors.push(`slot ${slotId} expected >=${minCount} supported claims, got ${count}`);
  }

  const unsupportedClaimCount = envelope.claims.filter(claim => claim.factual && claim.citations.length === 0).length;
  if (unsupportedClaimCount > 0) errors.push(`unsupported factual claims: ${unsupportedClaimCount}`);
  errors.push(...regexErrors(envelope, fixture.prohibitedRegex));

  let missingSlotChecks = 0;
  let missingSlotHits = 0;
  for (const removeCase of fixture.removeEvidenceCases ?? []) {
    const removed = new Set(removeCase.removeWindowIds);
    const removedEnvelope = buildDeterministicAnswerEnvelope({
      ...recall,
      evidence: recall.evidence.filter((e: any) => !removed.has(String(e.span_id ?? e.id))),
    } as RecallResult, { maxEvidence: 8, maxQuoteChars: 520 });
    for (const slot of removeCase.expectedMissingSlots) {
      missingSlotChecks++;
      if (removedEnvelope.missingSlots.includes(slot)) missingSlotHits++;
      else errors.push(`remove case ${removeCase.id} missing slot ${slot} was not reported`);
    }
    errors.push(...regexErrors(removedEnvelope, removeCase.prohibitedRegex, `removeCase ${removeCase.id} prohibitedRegex`));
  }

  let shuffleStability: FixtureMetric['shuffleStability'] = 'not_exercised';
  if (fixture.metamorphic?.shuffleStability) {
    const shuffled = buildDeterministicAnswerEnvelope({ ...recall, evidence: [...recall.evidence].reverse() } as RecallResult, { maxEvidence: 8, maxQuoteChars: 520 });
    shuffleStability = normalizeAnswerForStability(envelope) === normalizeAnswerForStability(shuffled) ? 'pass' : 'fail';
    if (shuffleStability === 'fail') errors.push('shuffle stability failed');
  }

  const hardcodeGuard = regexErrors(envelope, fixture.prohibitedRegex).length === 0 ? 'pass' : 'fail';
  const requiredSlotCoverage = fixture.requiredSlots.length === 0 ? 1 : countSupportedRequiredSlots(envelope, fixture.requiredSlots) / fixture.requiredSlots.length;
  const invalid = invalidCitationCount(envelope);
  const factualClaims = envelope.claims.filter(claim => claim.factual).length;

  return {
    fixtureId: fixture.id,
    shapeId: envelope.shape,
    status: envelope.status,
    requiredSlotCoverage,
    claimCount: envelope.claims.length,
    unsupportedClaimCount,
    citationIntegrity: factualClaims === 0 ? 1 : (factualClaims - unsupportedClaimCount - invalid) / factualClaims,
    invalidCitationCount: invalid,
    missingSlotPrecision: missingSlotChecks === 0 ? 1 : missingSlotHits / missingSlotChecks,
    conflictHandling: 'not_exercised',
    shuffleStability,
    hardcodeGuard,
    errors,
  };
}

const metrics = loadFixtures().map(evaluateFixture);
const failed = metrics.filter(metric => metric.errors.length > 0);
const summary = {
  schema: 'gbrain.deterministic_answer_eval.v1',
  fixtureCount: metrics.length,
  pass: failed.length === 0,
  metrics,
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length > 0) process.exitCode = 1;
