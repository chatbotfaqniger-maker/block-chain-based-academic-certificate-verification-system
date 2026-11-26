import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseXlsxRoster } from "../src/student-roster-xlsx.js";

async function makeFile(build) {
  const workbook = new ExcelJS.Workbook();
  await build(workbook);
  const bytes = await workbook.xlsx.writeBuffer();
  return { arrayBuffer: async () => bytes };
}

test("parses one valid XLSX roster and normalizes its fields", async () => {
  const file = await makeFile(async workbook => {
    const sheet = workbook.addWorksheet("Roster");
    sheet.addRow(["Student Number", "Full Name", "Faculty", "Department", "Programme", "Qualification", "Award Date"]);
    sheet.addRow(["001/CS/2026", "Ada Student", "Science", "Computer Science", "Computing", "BSc", new Date("2026-10-15T00:00:00.000Z")]);
  });
  const rows = await parseXlsxRoster(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].studentNumber, "001/CS/2026");
  assert.equal(rows[0].fullName, "Ada Student");
  assert.equal(rows[0].awardDate, "2026-10-15");
});

test("rejects numeric student numbers to prevent loss of leading zeroes", async () => {
  const file = await makeFile(async workbook => {
    const sheet = workbook.addWorksheet("Roster");
    sheet.addRow(["student_number", "full_name", "faculty", "department", "programme", "qualification"]);
    sheet.addRow([12345, "Ada Student", "Science", "Computer Science", "Computing", "BSc"]);
  });
  await assert.rejects(() => parseXlsxRoster(file), /formatted as Text/);
});

test("rejects formula cells rather than importing computed workbook values", async () => {
  const file = await makeFile(async workbook => {
    const sheet = workbook.addWorksheet("Roster");
    sheet.addRow(["student_number", "full_name", "faculty", "department", "programme", "qualification"]);
    sheet.addRow(["001/CS/2026", { formula: '"Ada Student"', result: "Ada Student" }, "Science", "Computer Science", "Computing", "BSc"]);
  });
  await assert.rejects(() => parseXlsxRoster(file), /Formula cells are not accepted/);
});

test("rejects workbooks with multiple visible data sheets", async () => {
  const file = await makeFile(async workbook => {
    for (const name of ["Roster A", "Roster B"]) {
      const sheet = workbook.addWorksheet(name);
      sheet.addRow(["student_number", "full_name", "faculty", "department", "programme", "qualification"]);
      sheet.addRow(["001/CS/2026", "Ada Student", "Science", "Computer Science", "Computing", "BSc"]);
    }
  });
  await assert.rejects(() => parseXlsxRoster(file), /exactly one visible/);
});
