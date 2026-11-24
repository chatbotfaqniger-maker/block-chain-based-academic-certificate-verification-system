export const INSTITUTION_CATEGORIES = Object.freeze([
  "HIGHER_EDUCATION",
  "SECONDARY_SCHOOL",
  "VOCATIONAL_TRAINING",
  "PROFESSIONAL_BODY",
  "CORPORATE_ISSUER"
]);

export const IDENTIFIER_LABEL_PRESETS = Object.freeze({
  MATRICULATION_NUMBER: "Matriculation Number",
  ADMISSION_NUMBER: "Admission Number",
  STUDENT_ID: "Student ID",
  LEARNER_ID: "Learner ID",
  MEMBERSHIP_NUMBER: "Membership Number",
  EMPLOYEE_ID: "Employee ID",
  CANDIDATE_NUMBER: "Candidate Number",
  CUSTOM: "Custom identifier"
});

const MAX_IDENTIFIER_LENGTH = 80;

/**
 * Normalize an organization-scoped external identity value.
 * This intentionally mirrors VERITY's existing student-number normalization:
 * Unicode compatibility normalization, trim, uppercase and remove whitespace.
 * It does not make the identifier globally unique or replace the VERITY user ID.
 */
export function normalizeInstitutionIdentifier(value) {
  if (typeof value !== "string") {
    throw new TypeError("Institution identifier must be text.");
  }
  const displayValue = value.normalize("NFKC").trim();
  if (displayValue.length < 2 || displayValue.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error("Institution identifier must contain between 2 and 80 characters.");
  }
  if (/[\u0000-\u001F\u007F]/u.test(displayValue)) {
    throw new Error("Institution identifier contains unsupported control characters.");
  }
  const normalizedValue = displayValue.toUpperCase().replace(/\s+/gu, "");
  if (!normalizedValue) {
    throw new Error("Institution identifier is required.");
  }
  return { displayValue, normalizedValue };
}

export function normalizeInstitutionCategory(value) {
  const category = String(value ?? "").trim().toUpperCase();
  if (!INSTITUTION_CATEGORIES.includes(category)) {
    throw new Error("Select a supported VERITY issuer category.");
  }
  return category;
}

export function resolveIdentifierLabel({ preset = "MATRICULATION_NUMBER", customLabel = "" } = {}) {
  const key = String(preset).trim().toUpperCase();
  if (!Object.hasOwn(IDENTIFIER_LABEL_PRESETS, key)) {
    throw new Error("Select a supported institution identifier label.");
  }
  if (key !== "CUSTOM") return IDENTIFIER_LABEL_PRESETS[key];
  const label = String(customLabel).normalize("NFKC").trim();
  if (label.length < 2 || label.length > 40) {
    throw new Error("Custom identifier label must contain between 2 and 40 characters.");
  }
  if (/[<>\u0000-\u001F\u007F]/u.test(label)) {
    throw new Error("Custom identifier label contains unsupported characters.");
  }
  return label;
}
