import test from "node:test";
import assert from "node:assert/strict";
import { parseRosterCsv } from "../server/student-roster.js";

test("parses a basic UTF-8 roster and normalizes header names", () => {
  const rows = parseRosterCsv("\uFEFFStudent Number,Full Name,Academic Session\r\nCSC/2022/001,Abu Dinar,2025/2026\r\n");
  assert.deepEqual(rows, [{
    student_number: "CSC/2022/001",
    full_name: "Abu Dinar",
    academic_session: "2025/2026"
  }]);
});

test("supports commas, escaped quotes and newlines inside quoted values", () => {
  const rows = parseRosterCsv('student_number,full_name,department\n001,"Suleiman, Yakubu","Computer ""Science""\nDepartment"\n');
  assert.equal(rows[0].full_name, "Suleiman, Yakubu");
  assert.equal(rows[0].department, 'Computer "Science"\nDepartment');
});

test("ignores blank rows but preserves leading zeroes in matriculation numbers", () => {
  const rows = parseRosterCsv("student_number,full_name\n00017,Student One\n\n00018,Student Two\n");
  assert.deepEqual(rows.map(row => row.student_number), ["00017", "00018"]);
});

test("rejects missing required headers", () => {
  assert.throws(() => parseRosterCsv("matric_number,full_name\n001,Student\n"), /student_number and full_name/);
});

test("rejects duplicate normalized headers", () => {
  assert.throws(() => parseRosterCsv("student-number,student_number,full_name\n001,001,Student\n"), /duplicate column headers/);
});

test("rejects malformed quoting and inconsistent row widths", () => {
  assert.throws(() => parseRosterCsv('student_number,full_name\n001,"Unclosed\n'), /unclosed quoted field/);
  assert.throws(() => parseRosterCsv("student_number,full_name\n001,Student,Unexpected\n"), /more values than the header/);
  assert.throws(() => parseRosterCsv("student_number,full_name\n001\n"), /missing columns/);
});
