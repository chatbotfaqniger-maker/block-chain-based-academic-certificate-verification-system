const REQUIRED_HEADERS = ["student_number", "full_name"];

/**
 * Parse institution roster CSV without third-party dependencies.
 * Supports UTF-8 BOM, CRLF/LF, escaped quotes, commas and newlines in quoted cells.
 */
export function parseRosterCsv(input) {
  if (typeof input !== "string") throw new TypeError("Roster CSV input must be text.");
  const source = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += ch;
      }
      continue;
    }

    if (afterQuote && ch !== "," && ch !== "\r" && ch !== "\n" && ch !== " " && ch !== "\t") {
      throw new Error("The CSV contains unexpected characters after a quoted field.");
    }
    if (ch === '"' && field.length === 0 && !afterQuote) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
    } else if (ch === "\r") {
      if (next !== "\n" && i !== source.length - 1) {
        throw new Error("The CSV contains an invalid line ending.");
      }
    } else if (!afterQuote) {
      field += ch;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headerRow = rows.shift() || [];
  const headers = headerRow.map(value =>
    String(value).trim().toLowerCase().replace(/[\s-]+/g, "_")
  );

  if (!headers.length || headers.some(header => !header)) {
    throw new Error("The CSV must contain non-empty column headers.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("The CSV contains duplicate column headers.");
  }
  for (const key of REQUIRED_HEADERS) {
    if (!headers.includes(key)) {
      throw new Error("CSV must include student_number and full_name columns.");
    }
  }

  return rows
    .filter(values => values.some(value => String(value ?? "").trim()))
    .map((values, index) => {
      if (values.length > headers.length) {
        throw new Error("CSV row " + (index + 2) + " contains more values than the header.");
      }
      if (values.length < headers.length) {
        throw new Error("CSV row " + (index + 2) + " has missing columns.");
      }
      return Object.fromEntries(headers.map((header, column) => [
        header,
        String(values[column] ?? "").trim()
      ]));
    });
}
