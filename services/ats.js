import { supabase } from '../supabase.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { performLlmAtsAnalysis } from './ai.js';

const APPLICATIONS_KEY = '@job_system_applications';

// -----------------------------------------------------------------------------
// EXPANDED SKILL CATALOG & SYNONYM MAPPING
// -----------------------------------------------------------------------------

export const EXTENDED_SKILL_CATALOG = [
  // Programming Languages
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C#', 'C++', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL', 'HTML', 'CSS',
  
  // AI, LLM & Machine Learning
  'Generative AI', 'AI Agents', 'LLMs', 'Large Language Models', 'Prompt Engineering', 'LangGraph', 'LangChain',
  'OpenAI', 'ChatGPT', 'Claude', 'Gemini', 'Llama', 'Custom GPTs', 'AI Assistants', 'Chatbots',
  'Machine Learning', 'Deep Learning', 'NLP', 'Natural Language Processing', 'Computer Vision',
  'PyTorch', 'TensorFlow', 'Hugging Face', 'Vector Databases', 'Pinecone', 'ChromaDB', 'FAISS', 'RAG',
  'Pandas', 'NumPy', 'Scikit-Learn', 'Data Science', 'Data Analysis',

  // Automation & Low-Code / Workflow Orchestration
  'Automation', 'Workflow Automation', 'n8n', 'Zapier', 'Make', 'Integromat', 'Power Automate',
  'Airflow', 'Celery', 'Process Automation', 'RPA',

  // Web & Mobile Frameworks
  'React', 'React Native', 'Next.js', 'Vue', 'Vue.js', 'Angular', 'Svelte', 'Node.js', 'Express',
  'FastAPI', 'Django', 'Flask', 'NestJS', 'GraphQL', 'REST APIs', 'WebSockets', 'Tailwind CSS',

  // Databases & Cloud
  'PostgreSQL', 'Postgres', 'Supabase', 'MongoDB', 'MySQL', 'Redis', 'Firebase', 'SQLite',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Linux', 'Serverless', 'Vercel',

  // DevOps, Tooling & Practices
  'Git', 'GitHub', 'CI/CD', 'GitHub Actions', 'Unit Testing', 'Jest', 'PyTest', 'Agile', 'Scrum',
  'Microservices', 'System Design', 'Debugging', 'Performance Optimization',

  // Digital & Business Domains
  'SEO', 'Digital Marketing', 'Content Strategy', 'Product Management',
  'Communication', 'Leadership', 'Problem Solving', 'Teamwork', 'Analytical Thinking',
];

// Semantic synonyms and equivalences (case-insensitive)
export const SKILL_SYNONYMS = {
  'generative ai': ['genai', 'gen ai', 'llm', 'llms', 'large language models', 'chatgpt', 'openai', 'claude', 'gemini', 'gpt-4', 'prompt engineering'],
  'ai agents': ['agentic', 'agents', 'autonomous agents', 'langgraph', 'crewai', 'autogen', 'custom gpts', 'ai assistants'],
  'llms': ['large language models', 'llm', 'generative ai', 'genai', 'openai', 'claude', 'gpt'],
  'prompt engineering': ['prompting', 'custom gpts', 'system prompts', 'few-shot', 'chain of thought'],
  'automation': ['workflow automation', 'process automation', 'n8n', 'zapier', 'make', 'automations', 'automated'],
  'n8n': ['workflow automation', 'automation', 'make', 'zapier'],
  'zapier': ['workflow automation', 'automation', 'n8n', 'make'],
  'make': ['integromat', 'workflow automation', 'automation', 'n8n', 'zapier'],
  'python': ['python3', 'py', 'fastapi', 'django', 'flask'],
  'javascript': ['js', 'es6', 'ecmascript', 'typescript', 'node.js', 'react'],
  'typescript': ['ts', 'javascript'],
  'react': ['react.js', 'reactjs', 'react native', 'next.js'],
  'react native': ['react', 'mobile development', 'expo'],
  'node.js': ['nodejs', 'node', 'express'],
  'postgresql': ['postgres', 'psql', 'sql', 'supabase'],
  'supabase': ['postgresql', 'postgres', 'baas', 'firebase'],
  'docker': ['containerization', 'containers', 'kubernetes'],
  'kubernetes': ['k8s', 'docker', 'container orchestration'],
  'rest apis': ['restful', 'rest api', 'api development', 'api integration', 'endpoints'],
  'graphql': ['apollo', 'graphql apis'],
  'ci/cd': ['continuous integration', 'github actions', 'devops', 'pipelines'],
  'seo': ['search engine optimization', 'technical seo', 'organic search', 'keyword research'],
  'digital marketing': ['content strategy', 'marketing technology', 'growth marketing', 'seo'],
};

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

export const includesTerm = (text, term) => {
  if (!text || !term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s/-]+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
};

// Checks if text mentions term directly or via any known synonym
export const matchesSkillOrSynonym = (text, skillName) => {
  if (!text || !skillName) return false;
  if (includesTerm(text, skillName)) return true;

  const lower = skillName.toLowerCase();
  const synonyms = SKILL_SYNONYMS[lower] || [];
  for (const syn of synonyms) {
    if (includesTerm(text, syn)) return true;
  }
  return false;
};

const unique = (items) => [...new Map(items.map((item) => [item.toLowerCase(), item])).values()];

/**
 * Dynamically extracts skills and requirements from free-form job text.
 * Combines known skill catalog matching with dynamic tech noun and bullet phrase extraction.
 */
export function extractSkillsFromJobText(jobText) {
  if (!jobText) return [];
  const normalized = jobText.normalize('NFKD');
  const found = [];

  // 1. Check against extended skill catalog
  for (const skill of EXTENDED_SKILL_CATALOG) {
    if (includesTerm(normalized, skill)) {
      found.push(skill);
    }
  }

  // 2. Extract bullet phrases or capitalized tech pairs from Requirements sections
  const bulletMatches = normalized.match(/(?:•|\*|-|\d+\.)\s*([A-Za-z0-9\s,./()+-]{3,45})/g) || [];
  for (const rawBullet of bulletMatches) {
    const clean = rawBullet.replace(/^[•*\-\d.]+\s*/, '').trim();
    if (clean.length >= 3 && clean.length <= 30) {
      const lower = clean.toLowerCase();
      const blacklist = ['requirements', 'responsibilities', 'experience', 'preferred', 'location', 'salary', 'shift', 'on-site', 'remote', 'hybrid', 'benefits', 'apply', 'whatsapp'];
      if (!blacklist.some((w) => lower.includes(w)) && !found.some((f) => f.toLowerCase() === lower)) {
        // If it looks like a skill or tool (contains noun / capitalized)
        if (/^[A-Z][A-Za-z0-9\s/+-]+$/.test(clean) && clean.split(/\s+/).length <= 4) {
          found.push(clean);
        }
      }
    }
  }

  return unique(found);
}

// -----------------------------------------------------------------------------
// CLIENT-SIDE ATS REPORT BUILDER (SMART LOCAL ENGINE)
// -----------------------------------------------------------------------------

export function buildClientAtsReport({
  jobTitle = '',
  companyName = '',
  requirements = '',
  description = '',
  resumeContent = '',
  resumeName = '',
  stage = 'before',
}) {
  const fullJobText = `${jobTitle} ${requirements} ${description}`.normalize('NFKD');
  const resumeText = (resumeContent || '').normalize('NFKD');

  // 1. Dynamic skill extraction
  const requiredSkills = extractSkillsFromJobText(fullJobText);
  const resumeSkills = EXTENDED_SKILL_CATALOG.filter((skill) => matchesSkillOrSynonym(resumeText, skill));

  // 2. Match required skills using synonym-aware matching
  const matchedSkills = [];
  const missingSkills = [];

  for (const reqSkill of requiredSkills) {
    if (matchesSkillOrSynonym(resumeText, reqSkill)) {
      matchedSkills.push(reqSkill);
    } else {
      missingSkills.push(reqSkill);
    }
  }

  // 3. Weight core skills vs peripheral/secondary skills
  // Core skills: skills found directly in jobTitle or requirements
  const coreContext = `${jobTitle} ${requirements}`.toLowerCase();
  let coreTotal = 0;
  let coreMatched = 0;
  let secTotal = 0;
  let secMatched = 0;

  for (const skill of requiredSkills) {
    const isCore = coreContext.includes(skill.toLowerCase());
    const isMatched = matchedSkills.includes(skill);
    if (isCore) {
      coreTotal++;
      if (isMatched) coreMatched++;
    } else {
      secTotal++;
      if (isMatched) secMatched++;
    }
  }

  let skillsScore = 70;
  if (requiredSkills.length > 0) {
    if (coreTotal > 0 && secTotal > 0) {
      const coreRatio = coreMatched / coreTotal;
      const secRatio = secMatched / secTotal;
      skillsScore = (coreRatio * 75) + (secRatio * 25);
    } else {
      skillsScore = (matchedSkills.length / requiredSkills.length) * 100;
    }
  } else {
    skillsScore = Math.min(88, 55 + resumeSkills.length * 3);
  }

  // Title alignment score
  const titleTerms = jobTitle.toLowerCase().split(/[^a-z0-9+#.]+/).filter((term) => term.length > 2);
  const titleMatches = titleTerms.filter((term) => resumeText.toLowerCase().includes(term));
  const titleScore = titleTerms.length ? (titleMatches.length / titleTerms.length) * 100 : 70;

  // Experience relevance score
  const experienceRequired = /(?:[2-9]|10)\+?\s*(?:years?|yrs?)/i.test(fullJobText);
  const hasExperience = /\b(experience|employment|work history|professional experience|projects)\b/i.test(resumeText);
  const experienceScore = hasExperience ? (experienceRequired ? 88 : 95) : 40;

  // Education score
  const educationRequired = /\b(bachelor|master|degree|bsc|bs|msc|phd|computer science)\b/i.test(fullJobText);
  const hasEducation = /\b(education|bachelor|master|degree|bsc|bs|msc|phd|university|college|b\.s|m\.s)\b/i.test(resumeText);
  const educationScore = educationRequired ? (hasEducation ? 100 : 45) : (hasEducation ? 95 : 80);

  // Formatting & structure score
  const sectionHits = ['summary', 'skills', 'experience', 'education'].filter((section) =>
    resumeText.toLowerCase().includes(section)
  ).length;
  const hasContact = /@|linkedin|github|https?:\/\/|\+?\d[\d\s()-]{7,}/i.test(resumeText);
  const hasNoBoxDrawing = !/[═─│┌┐└┘║╔╗╚╝]/.test(resumeText);
  const goodLength = resumeText.length >= 700 && resumeText.length <= 10000;
  const formattingScore = clampScore(
    35 + sectionHits * 12 + (hasContact ? 10 : 0) + (hasNoBoxDrawing ? 5 : -10) + (goodLength ? 8 : 0)
  );

  const overallScore = clampScore(
    skillsScore * 0.45 + titleScore * 0.20 + experienceScore * 0.15 + educationScore * 0.10 + formattingScore * 0.10
  );

  // Suggestions
  const suggestions = [];
  if (missingSkills.length > 0) {
    const topMissing = missingSkills.slice(0, 4);
    suggestions.push({
      priority: 'high',
      title: 'Close key technical gaps',
      detail: `Integrate hands-on evidence for ${topMissing.join(', ')} into your Skills or Project highlights if relevant to your experience.`,
      action: 'skills',
    });
  }

  if (titleScore < 70) {
    suggestions.push({
      priority: 'high',
      title: 'Align headline & target role',
      detail: `Explicitly align your top headline with “${jobTitle || 'Target Role'}” so recruiters and ATS immediately index your resume.`,
      action: 'headline',
    });
  }

  if (!hasExperience) {
    suggestions.push({
      priority: 'high',
      title: 'Add structured experience section',
      detail: 'Present roles or projects with bullet points stating the tools used, technical challenge, and measurable outcome.',
      action: 'experience',
    });
  } else {
    suggestions.push({
      priority: 'medium',
      title: 'Quantify impact & outcomes',
      detail: `Highlight metrics (e.g. latency reduced, hours saved, accuracy improved, automations deployed) for ${companyName || 'the employer'}.`,
      action: 'impact',
    });
  }

  if (!hasNoBoxDrawing) {
    suggestions.push({
      priority: 'high',
      title: 'Remove ASCII borders & decorative characters',
      detail: 'Decorative unicode border lines (e.g. ════) confuse enterprise ATS parsers. Use standard plain uppercase section headings.',
      action: 'format',
    });
  } else if (formattingScore < 75) {
    suggestions.push({
      priority: 'medium',
      title: 'Refine standard ATS structure',
      detail: 'Ensure your resume uses standard section headers: PROFESSIONAL SUMMARY, CORE COMPETENCIES, EXPERIENCE, EDUCATION.',
      action: 'format',
    });
  }

  return {
    stage,
    score: overallScore,
    scoreBreakdown: {
      skills: clampScore(skillsScore),
      title: clampScore(titleScore),
      experience: clampScore(experienceScore),
      education: clampScore(educationScore),
      formatting: formattingScore,
    },
    matchedSkills,
    missingSkills,
    resumeSkills,
    suggestions,
    summary: overallScore >= 85
      ? 'Outstanding match! Your profile and skills strongly align with this position.'
      : overallScore >= 70
        ? 'Promising candidate match. Closing a few targeted keyword gaps will make this application highly competitive.'
        : 'Foundational match. The resume needs targeted alignment with the job requirements before submission.',
    resumeName,
    analyzedAt: new Date().toISOString(),
    source: 'smart-local-ats-engine',
  };
}

// -----------------------------------------------------------------------------
// PERSIST REPORT TO DATABASE & STORAGE
// -----------------------------------------------------------------------------

export async function persistAtsReport({ userId, applicationId, report, resumeContent = '', resumeName = '' }) {
  if (!userId || !applicationId || !report) return report;

  const isAfter = report.stage === 'after';
  const applicationUpdate = isAfter
    ? {
        tailored_ats_score: report.score,
        tailored_ats_report: report,
        tailored_resume_content: resumeContent || null,
        ats_analyzed_at: report.analyzedAt,
      }
    : {
        ats_score: report.score,
        ats_report: report,
        resume_snapshot: resumeContent || null,
        ats_analyzed_at: report.analyzedAt,
      };

  try {
    await supabase
      .from('applications')
      .update({ ...applicationUpdate, updated_at: new Date().toISOString() })
      .eq('id', applicationId)
      .eq('user_id', userId);

    await supabase.from('application_ats_reports').insert({
      user_id: userId,
      application_id: applicationId,
      stage: report.stage,
      score: report.score,
      score_breakdown: report.scoreBreakdown,
      matched_skills: report.matchedSkills,
      missing_skills: report.missingSkills,
      suggestions: report.suggestions,
      summary: report.summary,
      resume_name: resumeName || null,
      resume_snapshot: resumeContent || null,
      source: report.source,
    });
  } catch (error) {
    console.warn('ATS report persistence notice:', error?.message || error);
  }

  try {
    const cacheKey = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const applications = JSON.parse(cached);
      const updated = applications.map((application) => application.id === applicationId
        ? {
            ...application,
            atsScore: isAfter ? application.atsScore : report.score,
            atsReport: isAfter ? application.atsReport : report,
            tailoredAtsScore: isAfter ? report.score : application.tailoredAtsScore,
            tailoredAtsReport: isAfter ? report : application.tailoredAtsReport,
            atsAnalyzedAt: report.analyzedAt,
          }
        : application);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(updated));
    }
  } catch (error) {
    console.warn('ATS local cache notice:', error?.message || error);
  }

  return report;
}

const normalizeAgentReport = (result, stage, resumeName) => ({
  stage,
  score: clampScore(result.score || 0),
  scoreBreakdown: result.score_breakdown || {},
  matchedSkills: result.matched_skills || [],
  missingSkills: result.missing_skills || [],
  resumeSkills: result.resume_skills || [],
  suggestions: result.suggestions || [],
  summary: result.summary || '',
  resumeName,
  analyzedAt: result.analyzed_at || new Date().toISOString(),
  source: 'langgraph-ats-agent',
});

// -----------------------------------------------------------------------------
// PRIMARY EXPORT: ANALYZE RESUME (LLM WITH LOCAL SMART FALLBACK)
// -----------------------------------------------------------------------------

export async function analyzeResumeForJob({
  userId = '',
  applicationId = '',
  jobTitle = '',
  companyName = '',
  requirements = '',
  description = '',
  resumeContent = '',
  resumeName = '',
  stage = 'before',
  llmProvider = 'OpenAI',
  llmApiKey = '',
  llmModel = '',
}) {
  // 1. If LLM API Key is configured, run deep AI ATS analysis directly
  if (llmApiKey && llmApiKey.trim().length > 5) {
    try {
      const aiReport = await performLlmAtsAnalysis({
        jobTitle,
        companyName,
        requirements,
        description,
        resumeContent,
        resumeName,
        provider: llmProvider,
        apiKey: llmApiKey,
        model: llmModel,
      });

      aiReport.stage = stage;
      return persistAtsReport({ userId, applicationId, report: aiReport, resumeContent, resumeName });
    } catch (aiErr) {
      console.warn(`Direct LLM ATS analysis notice (${aiErr.message}), falling back to local engine.`);
    }
  }

  // 2. Attempt local LangGraph Python agent server if active
  try {
    const response = await fetch('http://localhost:8000/api/agent/analyze-ats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        application_id: applicationId,
        job_title: jobTitle,
        company_name: companyName,
        requirements,
        job_description: description,
        raw_resume: resumeContent,
        resume_name: resumeName,
        stage,
        save_to_db: Boolean(userId && applicationId),
        llm_provider: llmProvider,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) return normalizeAgentReport(result, stage, resumeName);
    }
  } catch (_agentError) {
    // Local Python agent is offline; continue to smart local engine
  }

  // 3. Smart local ATS engine (dynamic skill extraction + synonym matching)
  const report = buildClientAtsReport({
    jobTitle,
    companyName,
    requirements,
    description,
    resumeContent,
    resumeName,
    stage,
  });

  return persistAtsReport({ userId, applicationId, report, resumeContent, resumeName });
}
