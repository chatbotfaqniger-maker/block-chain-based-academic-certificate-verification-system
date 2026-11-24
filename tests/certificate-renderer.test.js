import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { PAGE_SIZES, validateFieldLayout, renderCertificatePreview } from "../server/certificate-renderer.js";

test("certificate page sizes are standard landscape and portrait dimensions", () => {
  assert.deepEqual(PAGE_SIZES.A4_LANDSCAPE, [841.89, 595.28]);
  assert.deepEqual(PAGE_SIZES.A4_PORTRAIT, [595.28, 841.89]);
});

test("field layout accepts normalized coordinates and rejects unsafe layouts", () => {
  const layout = validateFieldLayout({ studentName: { x: 0.15, y: 0.48, width: 0.7, fontSize: 22, align: "center" } });
  assert.equal(layout.studentName.x, 0.15);
  assert.throws(() => validateFieldLayout({ secretField: { x: 0.5, y: 0.5 } }), /Unsupported certificate field/);
  assert.throws(() => validateFieldLayout({ studentName: { x: 1.2, y: 0.5, width: 0.7, fontSize: 20 } }), /outside/);
  assert.throws(() => validateFieldLayout({ studentName: { x: 0.5, y: 0.5, width: 0.7, fontSize: 20 } }), /outside/);
  assert.throws(() => validateFieldLayout({ studentName: { x: 0.1, y: 0.5, width: 0.7, fontSize: 20, align: "justify" } }), /alignment/);
});

test("built-in template produces a valid PDF preview with a non-verifying preview QR", async () => {
  const pdf = await renderCertificatePreview({
    template: { sourceType: "VERITY_TEMPLATE", templateKey: "verity-heritage", pageSize: "A4_LANDSCAPE", fieldLayout: {} },
    organizationName: "Example University",
    data: { studentName: "Amina Yusuf", qualification: "B.Sc.", programme: "Computer Science", awardDate: "2026-11-24" }
  });
  assert.ok(pdf.subarray(0, 5).toString("ascii") === "%PDF-");
  assert.ok(pdf.length > 1500);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1, "a generated certificate must not contain an extra blank page");
});


test("PDF institution artwork is rendered without adding a blank page", async () => {
  const artwork = await PDFDocument.create();
  artwork.addPage([841.89, 595.28]);
  const bytes = Buffer.from(await artwork.save());
  const rendered = await renderCertificatePreview({
    template: { sourceType: "INSTITUTION_ARTWORK", assetMimeType: "application/pdf", pageSize: "A4_LANDSCAPE", fieldLayout: {} },
    organizationName: "Example University",
    data: { studentName: "Amina Yusuf" },
    artworkBytes: bytes
  });
  assert.equal((await PDFDocument.load(rendered)).getPageCount(), 1);
});
