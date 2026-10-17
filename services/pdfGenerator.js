/**
 * Lightweight, 100% pure JavaScript PDF-1.4 generator for ATS resumes.
 * Zero external dependencies (no pdf-lib, no tslib, no canvas).
 * Outputs valid, standard PDF bytes that render in all browsers, PDF viewers, and ATS parsers.
 */

function sanitizePdfText(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E\t\n]/g, ' ');
}

export function generatePdfFromResumeText(resumeText) {
  const pageWidth = 612; // Letter width (pt)
  const pageHeight = 792; // Letter height (pt)
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 13.5;

  const lines = (resumeText || '').split('\n');
  const pages = [];
  let currentPageOps = [];
  let y = pageHeight - margin;

  const pushOp = (op) => currentPageOps.push(op);

  const startNewPage = () => {
    if (currentPageOps.length > 0) {
      pages.push(currentPageOps);
      currentPageOps = [];
    }
    y = pageHeight - margin;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      y -= lineHeight * 0.6;
      if (y < margin + 20) startNewPage();
      continue;
    }

    const isName = (i === 0);
    const isSectionHeading = /^(PROFESSIONAL SUMMARY|SUMMARY|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EDUCATION|SKILLS|TECHNICAL SKILLS|PROJECTS|CERTIFICATIONS|KEY COMPETENCIES|CORE COMPETENCIES|ACHIEVEMENTS)\b/i.test(trimmed) ||
      (trimmed === trimmed.toUpperCase() && trimmed.length < 35 && !trimmed.includes(':') && !trimmed.startsWith('•'));

    let fontKey = '/F1';
    let fontSize = 9.5;

    if (isName) {
      fontKey = '/F2';
      fontSize = 16;
      y -= 2;
    } else if (isSectionHeading) {
      fontKey = '/F2';
      fontSize = 12;
      y -= 6;
    }

    const charWidth = fontSize * 0.52;
    const maxChars = Math.max(20, Math.floor(maxWidth / charWidth));
    const words = trimmed.split(' ');
    let currentLine = '';

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (test.length > maxChars && currentLine) {
        if (y < margin + 15) startNewPage();
        pushOp(`BT ${fontKey} ${fontSize} Tf ${margin} ${y.toFixed(1)} Td (${sanitizePdfText(currentLine)}) Tj ET`);
        y -= lineHeight;
        currentLine = word;
      } else {
        currentLine = test;
      }
    }

    if (currentLine) {
      if (y < margin + 15) startNewPage();
      pushOp(`BT ${fontKey} ${fontSize} Tf ${margin} ${y.toFixed(1)} Td (${sanitizePdfText(currentLine)}) Tj ET`);
      y -= (isSectionHeading ? lineHeight + 2 : lineHeight);

      if (isSectionHeading) {
        pushOp(`0.8 0.83 0.88 RG 0.75 w ${margin} ${(y + 4).toFixed(1)} m ${pageWidth - margin} ${(y + 4).toFixed(1)} l S`);
        y -= 3;
      }
    }
  }

  if (currentPageOps.length > 0) {
    pages.push(currentPageOps);
  }
  if (pages.length === 0) {
    pages.push([`BT /F1 10 Tf ${margin} 740 (Resume) Tj ET`]);
  }

  // Build PDF-1.4 Data Structures
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontHelveticaId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontHelveticaBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageObjectIds = [];
  const streamObjectIds = [];

  for (let p = 0; p < pages.length; p++) {
    const streamContent = pages[p].join('\n');
    const streamBytes = new TextEncoder().encode(streamContent);
    const streamId = addObject(`<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream`);
    streamObjectIds.push(streamId);
  }

  // Calculate pages root ID
  const pagesRootId = objects.length + pages.length + 1;

  for (let p = 0; p < pages.length; p++) {
    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Contents ${streamObjectIds[p]} 0 R ` +
      `/Resources << /Font << /F1 ${fontHelveticaId} 0 R /F2 ${fontHelveticaBoldId} 0 R >> >> >>`
    );
    pageObjectIds.push(pageObjId);
  }

  const kidsRef = pageObjectIds.map(id => `${id} 0 R`).join(' ');
  const actualPagesRootId = addObject(`<< /Type /Pages /Kids [${kidsRef}] /Count ${pages.length} >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${actualPagesRootId} 0 R >>`);

  // Assemble full PDF
  let pdf = '%PDF-1.4\n';
  const offsets = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) {
    const offStr = String(offsets[i]).padStart(10, '0');
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
