import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTITUTION_CATEGORIES,
  normalizeInstitutionCategory,
  normalizeInstitutionIdentifier,
  resolveIdentifierLabel
} from "../server/institution-identity.js";

test("supports the approved additive issuer categories", () => {
  assert.deepEqual(INSTITUTION_CATEGORIES, [
    "HIGHER_EDUCATION",
    "SECONDARY_SCHOOL",
    "VOCATIONAL_TRAINING",
    "PROFESSIONAL_BODY",
    "CORPORATE_ISSUER"
  ]);
  assert.equal(normalizeInstitutionCategory(" secondary_school "), "SECONDARY_SCHOOL");
  assert.throws(() => normalizeInstitutionCategory("EMPLOYER"), /supported VERITY issuer category/);
});

test("normalizes identifiers consistently without losing the display value", () => {
  assert.deepEqual(normalizeInstitutionIdentifier("  Abc / 001  "), {
    displayValue: "Abc / 001",
    normalizedValue: "ABC/001"
  });
  assert.deepEqual(normalizeInstitutionIdentifier("００１７"), {
    displayValue: "0017",
    normalizedValue: "0017"
  });
});

test("rejects blank, oversized and control-character identifiers", () => {
  assert.throws(() => normalizeInstitutionIdentifier("  "), /between 2 and 80/);
  assert.throws(() => normalizeInstitutionIdentifier("A".repeat(81)), /between 2 and 80/);
  assert.throws(() => normalizeInstitutionIdentifier("AB\nCD"), /control characters/);
  assert.throws(() => normalizeInstitutionIdentifier(17), /must be text/);
});

test("resolves preset labels and validates custom labels", () => {
  assert.equal(resolveIdentifierLabel({ preset: "ADMISSION_NUMBER" }), "Admission Number");
  assert.equal(resolveIdentifierLabel({ preset: "CUSTOM", customLabel: "Candidate Code" }), "Candidate Code");
  assert.throws(() => resolveIdentifierLabel({ preset: "CUSTOM", customLabel: "x" }), /between 2 and 40/);
  assert.throws(() => resolveIdentifierLabel({ preset: "CUSTOM", customLabel: "<script>" }), /unsupported characters/);
});
