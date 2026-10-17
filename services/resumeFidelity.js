const SECTION_PATTERNS = [
  ['summary', /^(professional\s+summary|summary|profile|about(?:\s+me)?)$/i],
  ['skills', /^(core\s+competencies(?:\s*&\s*technical\s+skills)?|technical\s+skills|skills|key\s+skills|competencies)$/i],
  ['experience', /^(professional\s+experience|work\s+experience|experience|employment\s+history|work\s+history)$/i],
  ['projects', /^(selected\s+.*projects|projects(?:\s*&\s*technical\s+highlights)?|key\s+projects)$/i],
  ['education', /^(education(?:\s*&\s*credentials)?|academic\s+background|qualifications)$/i],
  ['certifications', /^(certifications?|licenses?\s*&\s*certifications?)$/i],
  ['achievements', /^(achievements?|awards?)$/i],
];

export function sectionKind(line = '') {
  const clean = String(line).trim().replace(/:$/, '');
  return SECTION_PATTERNS.find(([, pattern]) => pattern.test(clean))?.[0] || '';
}

export function parseResumeStructure(text = '') {
  const header = [];
  const sections = [];
  let current = null;
  String(text).split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line && !current) return;
    let kind = sectionKind(line);
    if (!kind && current && /^[A-Z][A-Z\s&/+-]{2,60}$/.test(line) && /[A-Z]/.test(line)) {
      kind = `other:${line.toLowerCase()}`;
    }
    if (kind) {
      current = { kind, heading: line, body: [] };
      sections.push(current);
    } else if (current) {
      if (line || current.body.length) current.body.push(line);
    } else if (line) {
      header.push(line);
    }
  });
  return { header, sections };
}

const isBullet = (line = '') => /^[-\u2022*]\s*/.test(line.trim());
const numericFacts = (line = '') => (line.match(/\b\d[\d,.]*%?\b/g) || []).sort();

function safeExperienceBullet(original, revised) {
  if (!revised) return original;
  const clean = revised.replace(/^[-\u2022*]\s*/, '').trim();
  const originalClean = original.replace(/^[-\u2022*]\s*/, '').trim();
  if (!clean || clean.length > Math.max(originalClean.length * 1.65, originalClean.length + 80)) return original;
  const originalNumbers = numericFacts(originalClean);
  const revisedNumbers = numericFacts(clean);
  if (revisedNumbers.some((value) => !originalNumbers.includes(value))) return original;
  const prefix = original.trim().match(/^[-\u2022*]/)?.[0] || '-';
  return `${prefix} ${clean}`;
}

function mergeExperience(originalBody, revisedBody) {
  const revisedBullets = revisedBody.filter(isBullet);
  let bulletIndex = 0;
  return originalBody.map((line) => {
    if (!isBullet(line)) return line;
    const merged = safeExperienceBullet(line, revisedBullets[bulletIndex]);
    bulletIndex += 1;
    return merged;
  });
}

/**
 * Restores all immutable resume facts from the uploaded source document.
 * Only summary, skills, and experience bullet wording may come from the AI draft.
 */
export function enforceResumeFidelity(sourceResume = '', aiDraft = '') {
  const source = parseResumeStructure(sourceResume);
  const draft = parseResumeStructure(aiDraft);
  if (!source.header.length || !source.sections.length) return String(sourceResume || aiDraft).trim();

  const draftByKind = new Map();
  draft.sections.forEach((section) => {
    if (!draftByKind.has(section.kind)) draftByKind.set(section.kind, section);
  });

  const output = [...source.header, ''];
  source.sections.forEach((section, index) => {
    const candidate = draftByKind.get(section.kind);
    let body = section.body;
    if ((section.kind === 'summary' || section.kind === 'skills') && candidate?.body?.some(Boolean)) {
      body = candidate.body;
    } else if (section.kind === 'experience' && candidate?.body?.length) {
      body = mergeExperience(section.body, candidate.body);
    }
    output.push(section.heading, ...body);
    if (index < source.sections.length - 1) output.push('');
  });
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function filterProfileToSourceResume(sourceResume = '', profile = {}) {
  const structure = parseResumeStructure(sourceResume);
  const head = structure.header.join(' | ');
  const exact = (value) => Boolean(value) && head.toLowerCase().includes(String(value).toLowerCase());
  const linked = (value, label) => Boolean(value) && (exact(value) || new RegExp(`\\b${label}\\b`, 'i').test(head));
  return {
    fullName: structure.header[0] || '',
    email: exact(profile.email) ? profile.email : '',
    phone: exact(profile.phone) ? profile.phone : '',
    location: exact(profile.location) ? profile.location : '',
    linkedin: linked(profile.linkedin, 'linkedin') ? profile.linkedin : '',
    github: linked(profile.github, 'github') ? profile.github : '',
    portfolio: linked(profile.portfolio, 'portfolio|website') ? profile.portfolio : '',
  };
}
