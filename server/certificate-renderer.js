import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export const PAGE_SIZES = Object.freeze({
  A4_LANDSCAPE: [841.89, 595.28],
  A4_PORTRAIT: [595.28, 841.89],
  LETTER_LANDSCAPE: [792, 612],
  LETTER_PORTRAIT: [612, 792]
});

export const CERTIFICATE_FIELDS = Object.freeze([
  "studentName", "studentNumber", "qualification", "programme", "faculty",
  "department", "classification", "awardDate", "certificateId"
]);

const COLORS = {
  navy: rgb(0.055, 0.12, 0.22),
  teal: rgb(0.12, 0.48, 0.45),
  muted: rgb(0.34, 0.42, 0.48),
  gold: rgb(0.72, 0.55, 0.25),
  white: rgb(1, 1, 1)
};

const safeText = value => String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);

export function validateFieldLayout(layout = {}) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    throw new TypeError("Field layout must be an object.");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(layout)) {
    if (!CERTIFICATE_FIELDS.includes(key)) throw new TypeError(`Unsupported certificate field: ${key}`);
    if (!value || typeof value !== "object") throw new TypeError(`Invalid layout for ${key}.`);
    const x = Number(value.x), y = Number(value.y), width = Number(value.width ?? 0.72);
    const fontSize = Number(value.fontSize ?? 16);
    if (![x, y, width, fontSize].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 1 || fontSize < 6 || fontSize > 64) {
      throw new RangeError(`Layout for ${key} is outside the supported page bounds.`);
    }
    const align = value.align ?? "center";
    if (!["left", "center", "right"].includes(align)) throw new TypeError(`Invalid alignment for ${key}.`);
    normalized[key] = { x, y, width, fontSize, align };
  }
  return normalized;
}

function drawText(page, font, value, position, pageWidth, pageHeight, color = COLORS.navy) {
  const text = safeText(value);
  if (!text) return;
  const size = position.fontSize;
  const width = pageWidth * position.width;
  const x = pageWidth * position.x;
  const y = pageHeight * (1 - position.y);
  const textWidth = font.widthOfTextAtSize(text, size);
  const left = position.align === "left" ? x : position.align === "right" ? x + width - textWidth : x + (width - textWidth) / 2;
  page.drawText(text, { x: Math.max(18, Math.min(pageWidth - 18, left)), y: Math.max(18, Math.min(pageHeight - 18, y)), size, font, color, maxWidth: width });
}

async function addQr(pdf, page, text, pageWidth, pageHeight) {
  const bytes = await QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 240 });
  const image = await pdf.embedPng(bytes);
  const size = Math.min(76, pageWidth * 0.11, pageHeight * 0.14);
  page.drawImage(image, { x: pageWidth - size - 38, y: 28, width: size, height: size });
}

function drawBuiltIn(page, font, bold, templateKey, institution, data, width, height) {
  const heritage = templateKey === "verity-heritage";
  const signature = templateKey === "verity-signature";
  const accent = heritage ? COLORS.gold : COLORS.teal;
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.white });
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: accent, borderWidth: heritage ? 3 : 1.5 });
  page.drawRectangle({ x: 29, y: 29, width: width - 58, height: height - 58, borderColor: accent, borderWidth: 0.55 });
  page.drawText("VERITY", { x: 40, y: height - 54, size: 10, font: bold, color: COLORS.teal, characterSpacing: 2 });
  const institutionText = safeText(institution).toUpperCase();
  const instSize = Math.min(18, Math.max(11, width / Math.max(30, institutionText.length * 0.58)));
  const instWidth = bold.widthOfTextAtSize(institutionText, instSize);
  page.drawText(institutionText, { x: (width - instWidth) / 2, y: height - 105, size: instSize, font: bold, color: COLORS.navy });
  page.drawText("CERTIFICATE OF", { x: width * 0.37, y: height - 170, size: 11, font: bold, color: accent, characterSpacing: 2 });
  page.drawText(heritage ? "ACADEMIC ACHIEVEMENT" : signature ? "ACADEMIC DISTINCTION" : "ACADEMIC AWARD", {
    x: width * 0.22, y: height - 215, size: 23, font: bold, color: COLORS.navy
  });
  page.drawText("This is to certify that", { x: width * 0.40, y: height - 260, size: 12, font, color: COLORS.muted });
  const name = safeText(data.studentName || "Graduate Name");
  const nameSize = Math.min(28, Math.max(18, width / Math.max(24, name.length * 0.55)));
  const nameWidth = bold.widthOfTextAtSize(name, nameSize);
  page.drawText(name, { x: (width - nameWidth) / 2, y: height - 310, size: nameSize, font: bold, color: COLORS.navy });
  page.drawRectangle({ x: width * 0.28, y: height - 324, width: width * 0.44, height: 1, color: accent });
  const award = safeText([data.qualification, data.programme].filter(Boolean).join(" · ") || "Qualification and Programme");
  page.drawText(award, { x: width * 0.18, y: height - 365, size: 13, font, color: COLORS.navy, maxWidth: width * 0.64 });
  const detail = safeText([data.faculty, data.department, data.classification].filter(Boolean).join(" · "));
  if (detail) page.drawText(detail, { x: width * 0.2, y: height - 390, size: 9, font, color: COLORS.muted, maxWidth: width * 0.6 });
  page.drawText("AUTHORIZED INSTITUTIONAL SIGNATORY", { x: 54, y: 70, size: 8, font: bold, color: COLORS.muted });
  page.drawText("DATE OF AWARD", { x: width * 0.42, y: 70, size: 8, font: bold, color: COLORS.muted });
  page.drawText(safeText(data.awardDate || "Award date"), { x: width * 0.42, y: 52, size: 10, font, color: COLORS.navy });
  page.drawText("PREVIEW · NOT A VALID CREDENTIAL", { x: width * 0.66, y: 45, size: 7, font: bold, color: COLORS.teal });
}

export async function renderCertificatePreview({ template, organizationName, data, artworkBytes = null, previewToken = "VERITY-PREVIEW-NOT-VALID" }) {
  if (!template || !["VERITY_TEMPLATE", "INSTITUTION_ARTWORK"].includes(template.sourceType)) {
    throw new TypeError("A supported certificate design is required.");
  }
  const dimensions = PAGE_SIZES[template.pageSize] || PAGE_SIZES.A4_LANDSCAPE;
  const pdf = template.sourceType === "INSTITUTION_ARTWORK" && template.assetMimeType === "application/pdf" && artworkBytes
    ? await PDFDocument.load(artworkBytes)
    : await PDFDocument.create();
  let page = pdf.getPages()[0] || pdf.addPage(dimensions);
  if (template.sourceType === "INSTITUTION_ARTWORK" && artworkBytes) {
    if (template.assetMimeType === "image/png" || template.assetMimeType === "image/jpeg") {
      const image = template.assetMimeType === "image/png" ? await pdf.embedPng(artworkBytes) : await pdf.embedJpg(artworkBytes);
      page = pdf.addPage(dimensions);
      const scale = Math.min(dimensions[0] / image.width, dimensions[1] / image.height);
      const w = image.width * scale, h = image.height * scale;
      page.drawImage(image, { x: (dimensions[0] - w) / 2, y: (dimensions[1] - h) / 2, width: w, height: h });
    } else if (template.assetMimeType !== "application/pdf") {
      throw new TypeError("Unsupported artwork type.");
    }
  } else {
    page = pdf.addPage(dimensions);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    drawBuiltIn(page, font, bold, template.templateKey, organizationName, data, dimensions[0], dimensions[1]);
  }
  const [width, height] = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const layout = validateFieldLayout(template.fieldLayout || {});
  for (const [field, position] of Object.entries(layout)) {
    drawText(page, field === "studentName" ? bold : font, data[field], position, width, height);
  }
  await addQr(pdf, page, previewToken, width, height);
  page.drawText("VERITY PREVIEW · NOT A VALID CREDENTIAL", {
    x: 22, y: 14, size: 7, font: bold, color: COLORS.teal
  });
  return Buffer.from(await pdf.save());
}
