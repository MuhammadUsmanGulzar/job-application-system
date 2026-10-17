import { supabase } from '../supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const APPLICATIONS_KEY = '@job_system_applications';

const SKILL_CATALOG = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C#', 'C++', 'SQL', 'HTML', 'CSS',
  'React', 'React Native', 'Next.js', 'Vue', 'Angular', 'Node.js', 'Express',
  'FastAPI', 'Django', 'Flask', 'LangGraph', 'LangChain', 'OpenAI', 'LLMs',
  'Generative AI', 'AI Agents', 'Prompt Engineering', 'Machine Learning', 'NLP',
  'Data Science', 'Pandas', 'NumPy', 'TensorFlow', 'PyTorch', 'n8n', 'Zapier',
  'PostgreSQL', 'Supabase', 'MongoDB', 'MySQL', 'Redis', 'Docker', 'Kubernetes',
  'AWS', 'Azure', 'GCP', 'Git', 'GitHub', 'REST APIs', 'GraphQL', 'CI/CD',
  'Agile', 'Scrum', 'Unit Testing', 'Automation', 'SEO', 'Digital Marketing',
  'Communication', 'Leadership', 'Problem Solving', 'Teamwork',
];

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

const includesTerm = (text, term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s/-]+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
};

const unique = (items) => [...new Map(items.map((item) => [item.toLowerCase(), item])).values()];

export function buildClientAtsReport({
  jobTitle = '',
  companyName = '',
  requirements = '',
  description = '',
  resumeContent = '',
  resumeName = '',
  stage = 'before',
}) {
  const jobText = `${jobTitle} ${requirements} ${description}`.normalize('NFKD');
  const resumeText = (resumeContent || '').normalize('NFKD');
  const requiredSkills = unique(SKILL_CATALOG.filter((skill) => includesTerm(jobText, skill)));
  const resumeSkills = unique(SKILL_CATALOG.filter((skill) => includesTerm(resumeText, skill)));
  const matchedSkills = requiredSkills.filter((skill) => includesTerm(resumeText, skill));
  const missingSkills = requiredSkills.filter((skill) => !includesTerm(resumeText, skill));

  const skillsScore = requiredSkills.length
    ? (matchedSkills.length / requiredSkills.length) * 100
    : Math.min(82, 45 + resumeSkills.length * 4);

  const titleTerms = jobTitle.toLowerCase().split(/[^a-z0-9+#.]+/).filter((term) => term.length > 2);
  const titleMatches = titleTerms.filter((term) => resumeText.toLowerCase().includes(term));
  const titleScore = titleTerms.length ? (titleMatches.length / titleTerms.length) * 100 : 65;

  const experienceRequired = /(?:[2-9]|10)\+?\s*(?:years?|yrs?)/i.test(jobText);
  const hasExperience = /\b(experience|employment|work history|professional experience)\b/i.test(resumeText);
  const experienceScore = hasExperience ? (experienceRequired ? 82 : 90) : 38;

  const educationRequired = /\b(bachelor|master|degree|bsc|bs|msc|phd)\b/i.test(jobText);
  const hasEducation = /\b(education|bachelor|master|degree|bsc|bs|msc|phd|university|college)\b/i.test(resumeText);
  const educationScore = educationRequired ? (hasEducation ? 100 : 30) : (hasEducation ? 92 : 75);

  const sectionHits = ['summary', 'skills', 'experience', 'education'].filter((section) =>
    resumeText.toLowerCase().includes(section)
  ).length;
  const hasContact = /@|linkedin|github|https?:\/\/|\+?\d[\d\s()-]{7,}/i.test(resumeText);
  const goodLength = resumeText.length >= 900 && resumeText.length <= 9000;
  const formattingScore = clampScore(30 + sectionHits * 13 + (hasContact ? 10 : 0) + (goodLength ? 8 : 0));

  const overallScore = clampScore(
    skillsScore * 0.5 + titleScore * 0.15 + experienceScore * 0.15 + educationScore * 0.1 + formattingScore * 0.1
  );

  const suggestions = [];
  if (missingSkills.length) {
    suggestions.push({
      priority: 'high',
      title: 'Close the keyword gap',
      detail: `Add evidence for ${missingSkills.slice(0, 5).join(', ')} only where these skills are genuinely part of your experience.`,
      action: 'skills',
    });
  }
  if (titleScore < 70) {
    suggestions.push({
      priority: 'high',
      title: 'Align the headline',
      detail: `Use “${jobTitle || 'the target role'}” naturally in your headline or summary when it accurately reflects your background.`,
      action: 'headline',
    });
  }
  if (!hasExperience) {
    suggestions.push({
      priority: 'high',
      title: 'Add an experience section',
      detail: 'Show relevant roles or projects with measurable outcomes and the tools used.',
      action: 'experience',
    });
  }
  if (formattingScore < 75) {
    suggestions.push({
      priority: 'medium',
      title: 'Improve ATS structure',
      detail: 'Use standard Summary, Skills, Experience, Projects, and Education headings with simple bullet points.',
      action: 'format',
    });
  }
  suggestions.push({
    priority: 'medium',
    title: 'Quantify impact',
    detail: `Strengthen the most relevant bullets with outcomes such as speed, revenue, reliability, users, or time saved for ${companyName || 'the employer'}.`,
    action: 'impact',
  });

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
    summary: overallScore >= 80
      ? 'Strong match. Focus on proof, clarity, and final review before applying.'
      : overallScore >= 60
        ? 'Promising match with specific keyword and positioning gaps to close.'
        : 'The resume needs targeted restructuring before this application is competitive.',
    resumeName,
    analyzedAt: new Date().toISOString(),
    source: 'client-ats-engine',
  };
}

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
}) {
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
      }),
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) return normalizeAgentReport(result, stage, resumeName);
    }
  } catch (_agentError) {
    // The deterministic client engine keeps ATS analytics available when the local agent is offline.
  }

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
