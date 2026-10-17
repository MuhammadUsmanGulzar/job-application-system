/** Professional ATS-safe PDF generator with metadata and clickable links. */
function pdfText(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '-').replace(/[^\x20-\x7E]/g, ' ');
}

const textWidth = (text, size, bold = false) => text.length * size * (bold ? 0.535 : 0.49);

function normalizeUrl(value, scheme = 'https') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^(https?:|mailto:|tel:)/i.test(clean)) return clean;
  return scheme === 'https' ? `https://${clean}` : `${scheme}:${clean}`;
}

function extractContact(resumeText, profile = {}) {
  const head = String(resumeText || '').split(/\r?\n/).slice(0, 7).join(' | ');
  const email = head.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  const phone = head.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || '';
  const linkedin = head.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s|]+/i)?.[0] || '';
  const github = head.match(/https?:\/\/(?:www\.)?github\.com\/[^\s|]+/i)?.[0] || '';
  const genericUrls = head.match(/https?:\/\/[^\s|]+/gi) || [];
  return {
    fullName: String(profile.fullName || '').trim(), email: String(profile.email || email).trim(),
    phone: String(profile.phone || phone).trim(), location: String(profile.location || '').trim(),
    linkedin: String(profile.linkedin || linkedin).trim(), github: String(profile.github || github).trim(),
    portfolio: String(profile.portfolio || genericUrls.find((url) => !/linkedin|github/i.test(url)) || '').trim(),
  };
}

function wrapText(text, size, maxWidth, bold = false) {
  const rows = [];
  let row = '';
  String(text || '').split(/\s+/).filter(Boolean).forEach((word) => {
    const candidate = row ? `${row} ${word}` : word;
    if (row && textWidth(candidate, size, bold) > maxWidth) { rows.push(row); row = word; }
    else row = candidate;
  });
  if (row) rows.push(row);
  return rows;
}

export function generatePdfFromResumeText(resumeText, profile = {}) {
  const W = 612; const H = 792; const left = 45; const right = 45; const top = 36; const bottom = 38;
  const contentWidth = W - left - right;
  const colors = { navy: '0.075 0.133 0.220', blue: '0.145 0.388 0.922', slate: '0.200 0.255 0.333', muted: '0.392 0.455 0.545', rule: '0.796 0.835 0.882' };
  const contact = extractContact(resumeText, profile);
  const sourceLines = String(resumeText || '').split(/\r?\n/).map((line) => line.trim());
  const nonempty = sourceLines.filter(Boolean);
  const name = contact.fullName || nonempty[0] || 'Candidate';
  const possibleTitle = nonempty[1] || '';
  const title = /@|\+?\d{7}|linkedin|github|portfolio/i.test(possibleTitle) ? ''
    : possibleTitle.replace(/\s*\|\s*TARGET ROLE\s*$/i, '').replace(/\b\w/g, (c) => c.toUpperCase());

  const pages = [];
  let page = { ops: [], links: [] };
  let y = H - top;
  const push = (op) => page.ops.push(op);
  const newPage = () => { pages.push(page); page = { ops: [], links: [] }; y = H - top; };
  const ensure = (height) => { if (y - height < bottom + 12) newPage(); };
  const drawText = (text, x, baseline, size = 9, bold = false, color = colors.slate) => {
    push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${pdfText(text)}) Tj ET`);
  };
  const addLink = (x, baseline, label, size, url) => {
    if (url) page.links.push({ x1: x, y1: baseline - 2, x2: x + textWidth(label, size), y2: baseline + size + 1, url });
  };
  const paragraph = (text, { size = 8.4, leading = 10.2, bold = false, indent = 0, bullet = false, color = colors.slate } = {}) => {
    const rows = wrapText(`${bullet ? '- ' : ''}${text}`, size, contentWidth - indent, bold);
    ensure(rows.length * leading + 2);
    rows.forEach((row) => {
      drawText(row, left + indent, y, size, bold, color);
      const match = row.match(/(https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/);
      if (match) {
        const before = row.slice(0, match.index);
        const uri = match[0].includes('@') && !match[0].startsWith('http') ? `mailto:${match[0]}` : match[0].replace(/[.,)]$/, '');
        addLink(left + indent + textWidth(before, size, bold), y, match[0], size, uri);
      }
      y -= leading;
    });
    y -= 1.8;
  };

  drawText(name.toUpperCase(), (W - textWidth(name.toUpperCase(), 19, true)) / 2, y, 19, true, colors.navy);
  y -= 24;
  if (title) { drawText(title, (W - textWidth(title, 10.3)) / 2, y, 10.3, false, colors.slate); y -= 16; }

  const items = [
    contact.email && { label: contact.email, url: normalizeUrl(contact.email, 'mailto') },
    contact.phone && { label: contact.phone, url: normalizeUrl(contact.phone, 'tel') },
    contact.location && { label: contact.location, url: '' },
    contact.linkedin && { label: 'LinkedIn', url: normalizeUrl(contact.linkedin) },
    contact.github && { label: 'GitHub', url: normalizeUrl(contact.github) },
    contact.portfolio && { label: 'Portfolio', url: normalizeUrl(contact.portfolio) },
  ].filter(Boolean);
  if (items.length) {
    const size = 8; const sep = '  |  ';
    const total = items.reduce((sum, item) => sum + textWidth(item.label, size), 0) + textWidth(sep, size) * (items.length - 1);
    let x = Math.max(left, (W - total) / 2);
    items.forEach((item, index) => {
      drawText(item.label, x, y, size, false, item.url ? colors.blue : colors.muted); addLink(x, y, item.label, size, item.url);
      x += textWidth(item.label, size);
      if (index < items.length - 1) { drawText(sep, x, y, size, false, colors.rule); x += textWidth(sep, size); }
    });
    y -= 14;
  }
  push(`${colors.blue} RG 0.9 w ${left} ${y.toFixed(2)} m ${W - right} ${y.toFixed(2)} l S`); y -= 11;

  const sections = /^(PROFESSIONAL SUMMARY|SUMMARY|CORE COMPETENCIES(?: & TECHNICAL SKILLS)?|CORE COMPETENCIES & TARGET SKILLS|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|SELECTED AGENTIC AI PROJECTS|PROJECTS(?: & TECHNICAL HIGHLIGHTS)?|EDUCATION(?: & CREDENTIALS)?|CERTIFICATIONS|ACHIEVEMENTS)$/i;
  let titleSkipped = false;
  sourceLines.forEach((line) => {
    if (!line || line.toUpperCase() === name.toUpperCase() || /^CANDIDATE CONTACT HEADER$/i.test(line) || /^(?:LINKEDIN\s*\|\s*)?GITHUB\s*\|\s*PORTFOLIO$/i.test(line)) return;
    const normalized = line.replace(/\s*\|\s*TARGET ROLE\s*$/i, '').replace(/\b\w/g, (c) => c.toUpperCase());
    if (title && !titleSkipped && normalized === title) { titleSkipped = true; return; }
    if (/(Email:|Phone:|LinkedIn|GitHub|Portfolio)/i.test(line) && (line.includes('@') || /Phone:/i.test(line))) return;
    if (sections.test(line)) {
      ensure(31); y -= 4; drawText(line.toUpperCase(), left, y, 10.1, true, colors.navy); y -= 4;
      push(`${colors.rule} RG 0.55 w ${left} ${y.toFixed(2)} m ${W - right} ${y.toFixed(2)} l S`); y -= 6;
    } else if (/^[-\u2022]/.test(line)) paragraph(line.replace(/^[-\u2022]\s*/, ''), { bullet: true });
    else if (line.includes(' | ') && line.length < 120 && !line.endsWith('.')) {
      const meta = /^(Contract|Full[- ]time|Part[- ]time|\d{4})\b/i.test(line);
      paragraph(line, { size: meta ? 8 : 8.9, leading: 10.1, bold: !meta, color: meta ? colors.muted : colors.navy });
    } else paragraph(line);
  });
  pages.push(page);

  pages.forEach((item, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    item.ops.push(`BT ${colors.muted} rg /F1 7.5 Tf ${(W - right - textWidth(label, 7.5)).toFixed(2)} 19 Td (${label}) Tj ET`);
  });
  const objects = [];
  const addObject = (content) => { objects.push(content); return objects.length; };
  const regular = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const streams = pages.map((item) => { const content = item.ops.join('\n'); return addObject(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`); });
  const annotations = pages.map((item) => item.links.map((link) => addObject(`<< /Type /Annot /Subtype /Link /Rect [${link.x1.toFixed(2)} ${link.y1.toFixed(2)} ${link.x2.toFixed(2)} ${link.y2.toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${pdfText(link.url)}) >> >>`)));
  const pagesRoot = addObject('');
  const pageIds = pages.map((item, index) => addObject(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${streams[index]} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> ${annotations[index].length ? `/Annots [${annotations[index].map((id) => `${id} 0 R`).join(' ')}] ` : ''}>>`));
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = addObject(`<< /Title (${pdfText(`${name} - Resume`)}) /Author (${pdfText(name)}) /Subject (ATS-optimized professional resume) /Creator (JobApply Resume Agent) >>`);
  const catalog = addObject(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`);
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(pdf).length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
