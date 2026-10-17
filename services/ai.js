/**
 * AI Service Configuration & Direct LLM Integration
 * 
 * Supports OpenAI, Google Gemini, and Groq for:
 * 1. Deep Contextual ATS Match Analysis & Scoring
 * 2. Intelligent, High-Impact Resume Optimization
 */

export const LLM_PROVIDERS_CONFIG = {
  Gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-1.5-flash',
    models: [
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Super Fast & Smart)' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Deep Context & Analysis)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Next Gen)' },
    ],
    placeholder: 'AIzaSy...',
    helpUrl: 'https://aistudio.google.com/app/apikey',
  },
  OpenAI: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Cost-Effective)' },
      { id: 'gpt-4o', label: 'GPT-4o (High Intelligence & Complex Jobs)' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    placeholder: 'sk-proj-...',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  Groq: {
    name: 'Groq (Llama 3)',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile & Free Tier)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Ultra Fast)' },
    ],
    placeholder: 'gsk_...',
    helpUrl: 'https://console.groq.com/keys',
  },
};

/**
 * Universal LLM completion dispatcher supporting Gemini, OpenAI, and Groq.
 */
export async function callLlmCompletion({
  provider = 'OpenAI',
  apiKey = '',
  model = '',
  messages = [],
  temperature = 0.2,
  responseFormat = null,
}) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error(`API Key for ${provider} is missing. Please configure it in Settings.`);
  }

  const selectedProvider = provider.toLowerCase();

  // 1. Google Gemini
  if (selectedProvider === 'gemini') {
    const targetModel = model || LLM_PROVIDERS_CONFIG.Gemini.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${cleanKey}`;

    // Separate system message if provided
    const systemMsg = messages.find((m) => m.role === 'system');
    const conversationMsgs = messages.filter((m) => m.role !== 'system');

    const contents = conversationMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = {
      contents,
      generationConfig: {
        temperature,
        ...(responseFormat === 'json_object' ? { responseMimeType: 'application/json' } : {}),
      },
    };

    if (systemMsg) {
      payload.systemInstruction = {
        parts: [{ text: systemMsg.content }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `Gemini API returned HTTP ${res.status}`;
      throw new Error(`Gemini Error: ${msg}`);
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    return text;
  }

  // 2. Groq
  if (selectedProvider === 'groq') {
    const targetModel = model || LLM_PROVIDERS_CONFIG.Groq.defaultModel;
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const payload = {
      model: targetModel,
      messages,
      temperature,
      ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `Groq API returned HTTP ${res.status}`;
      throw new Error(`Groq Error: ${msg}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  // 3. OpenAI (Default)
  const targetModel = model || LLM_PROVIDERS_CONFIG.OpenAI.defaultModel;
  const url = 'https://api.openai.com/v1/chat/completions';

  const payload = {
    model: targetModel,
    messages,
    temperature,
    ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `OpenAI API returned HTTP ${res.status}`;
    throw new Error(`OpenAI Error: ${msg}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * Intelligent ATS Match Analysis using LLM
 */
export async function performLlmAtsAnalysis({
  jobTitle = '',
  companyName = '',
  requirements = '',
  description = '',
  resumeContent = '',
  resumeName = '',
  provider = 'OpenAI',
  apiKey = '',
  model = '',
}) {
  const systemPrompt = `You are an elite Applicant Tracking System (ATS) auditor and senior technical recruiter.
Analyze how well the candidate's resume aligns with the target job posting.

Your response MUST be strict valid JSON with no markdown wrapping or backticks, conforming to this exact schema:
{
  "score": <number 0-100 overall ATS fit score>,
  "scoreBreakdown": {
    "skills": <number 0-100 for technical and core skill match>,
    "title": <number 0-100 for role alignment and seniority fit>,
    "experience": <number 0-100 for relevant work history and depth>,
    "education": <number 0-100 for academic background and credentials>,
    "formatting": <number 0-100 for ATS parsability and document structure>
  },
  "matchedSkills": [<array of specific technical/domain skills clearly evident in the resume that match the job>],
  "missingSkills": [<array of key required skills or tools mentioned in the job that are missing or weakly demonstrated in the resume>],
  "resumeSkills": [<array of top skills found in the candidate's resume>],
  "suggestions": [
    {
      "priority": "high" | "medium",
      "title": "<short descriptive title of recommendation>",
      "detail": "<actionable, specific advice explaining what to add or adjust>",
      "action": "skills" | "experience" | "headline" | "format" | "impact"
    }
  ],
  "summary": "<2-3 sentence executive assessment of candidate fit, strengths, and primary gap>"
}

Scoring Guidelines:
- Evaluate skills based on semantic meaning and context, not rigid keyword matching (e.g., GenAI/LLM is equivalent to Generative AI).
- Distinguish core non-negotiable requirements from peripheral/nice-to-have duties.
- Provide 3 to 5 realistic, constructive suggestions.`;

  const userContent = `TARGET JOB:
Role: ${jobTitle || 'Unspecified'}
Company: ${companyName || 'Hiring Company'}
Key Requirements:
${requirements || 'Not provided'}

Full Description:
${description || 'Not provided'}

---
CANDIDATE RESUME:
${resumeContent || 'No resume text provided.'}`;

  const responseText = await callLlmCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    responseFormat: 'json_object',
  });

  // Parse JSON response safely
  let cleanJson = responseText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleanJson);
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

  return {
    stage: 'before',
    score: clamp(parsed.score),
    scoreBreakdown: {
      skills: clamp(parsed.scoreBreakdown?.skills),
      title: clamp(parsed.scoreBreakdown?.title),
      experience: clamp(parsed.scoreBreakdown?.experience),
      education: clamp(parsed.scoreBreakdown?.education),
      formatting: clamp(parsed.scoreBreakdown?.formatting),
    },
    matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [],
    missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
    resumeSkills: Array.isArray(parsed.resumeSkills) ? parsed.resumeSkills : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    summary: parsed.summary || 'Resume analyzed with AI model.',
    resumeName,
    analyzedAt: new Date().toISOString(),
    source: `llm-${(provider || 'ai').toLowerCase()}`,
  };
}

/**
 * Intelligent Resume Optimization using LLM
 */
export async function performLlmResumeOptimization({
  jobTitle = '',
  companyName = '',
  requirements = '',
  description = '',
  rawResume = '',
  atsReport = null,
  provider = 'OpenAI',
  apiKey = '',
  model = '',
}) {
  const missing = atsReport?.missingSkills || [];
  const matched = atsReport?.matchedSkills || [];

  const systemPrompt = `You are a world-class executive resume writer and ATS optimization expert.
Your mission is to tailor and optimize the candidate's resume for the target job without fabricating false credentials.

CRITICAL FORMATTING RULES:
1. OUTPUT CLEAN, PROFESSIONAL PLAIN TEXT ONLY.
2. DO NOT USE ASCII BORDER BOXES, ASCII LINES, OR CHARACTERS LIKE "═════", "-----", or "=====". Real ATS parsers (Workday, Greenhouse, Taleo) break on them!
3. Use standard uppercase section headings:
   - CANDIDATE CONTACT HEADER (Name, Headline, Email | Phone | Location | Links)
   - PROFESSIONAL SUMMARY
   - CORE COMPETENCIES & TECHNICAL SKILLS
   - PROFESSIONAL EXPERIENCE
   - PROJECTS & TECHNICAL HIGHLIGHTS (if applicable)
   - EDUCATION & CREDENTIALS
4. Retain all factual work experience, real employer names, degrees, and dates.
5. Upgrade the Professional Summary to clearly position the candidate for the target role ("${jobTitle} at ${companyName || 'the target company'}").
6. In CORE COMPETENCIES, organize skills into categorized bullet points including relevant target tools (${missing.slice(0, 8).join(', ')}).
7. Elevate PROFESSIONAL EXPERIENCE bullet points with strong action verbs (Architected, Engineered, Streamlined, Orchestrated) and quantify impact (speed, reliability, time saved, automation metrics).

Your response MUST be strict valid JSON with no markdown wrapping:
{
  "tailoredResume": "<the complete, fully formatted, optimized resume in clean plaintext>",
  "matchedSkills": [<list of key skills now strongly highlighted>],
  "missingSkills": [<remaining gaps if any>],
  "enhancements": [<array of 3-5 concise bullet points describing the improvements made>]
}`;

  const userContent = `TARGET JOB:
Title: ${jobTitle}
Company: ${companyName || 'Hiring Organization'}
Requirements:
${requirements}
Description:
${description}

ATS Gap Analysis:
Matched Skills: ${matched.join(', ') || 'None identified yet'}
Missing / Gap Skills: ${missing.join(', ') || 'None identified'}

ORIGINAL RESUME:
${rawResume}`;

  const responseText = await callLlmCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.25,
    responseFormat: 'json_object',
  });

  let cleanJson = responseText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleanJson);
  const tailoredResume = (parsed.tailoredResume || '').trim();

  if (!tailoredResume) {
    throw new Error('AI resume optimization returned an empty resume.');
  }

  return {
    success: true,
    tailoredResume,
    resumeName: `Resume_Tailored_${jobTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)}.txt`,
    matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : matched,
    missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
    enhancements: Array.isArray(parsed.enhancements) ? parsed.enhancements : [
      `Targeted headline and executive summary for ${jobTitle} at ${companyName || 'the employer'}.`,
      'Integrated high-priority technical competencies and tools.',
      'Refined experience bullets with action verbs and quantifiable metrics.',
      'ATS-compliant clean document structure with zero parsing friction.',
    ],
    source: `llm-${(provider || 'ai').toLowerCase()}`,
  };
}

/**
 * Intelligent Job Post Parsing Agent using LLM
 */
export async function performLlmJobParse({
  rawText = '',
  provider = 'OpenAI',
  apiKey = '',
  model = '',
}) {
  const cleanInput = (rawText || '').trim();
  if (!cleanInput) {
    throw new Error('Raw job text is required for parsing.');
  }

  const systemPrompt = `You are a precision job posting parser agent.
Extract structured hiring fields from the raw, unstructured job posting (e.g. LinkedIn, WhatsApp, hiring notices).

Your output MUST be strict valid JSON with no markdown wrapping:
{
  "jobTitle": "<the specific job title, e.g. 'AI Expert', 'Senior Frontend Engineer'>",
  "companyName": "<the hiring company name, e.g. 'Techies Global'>",
  "recipientEmail": "<email to apply to, or empty string if not found>",
  "requirements": "<summary of technical skills, qualifications, tools and experience>",
  "description": "<complete cleaned job description and key responsibilities>"
}

Rules:
- Remove markdown emojis or weird formatting from companyName and jobTitle.
- If company name is not explicitly mentioned, use "Hiring Company".
- Extract legitimate email addresses only (look for 'Apply at', 'Email', etc.).`;

  const responseText = await callLlmCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: cleanInput },
    ],
    temperature: 0.1,
    responseFormat: 'json_object',
  });

  let cleanJson = responseText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleanJson);
  return {
    jobTitle: (parsed.jobTitle || 'Software Engineer').trim(),
    companyName: (parsed.companyName || 'Hiring Company').trim(),
    recipientEmail: (parsed.recipientEmail || '').trim(),
    requirements: (parsed.requirements || '').trim(),
    description: (parsed.description || cleanInput).trim(),
    source: `llm-${(provider || 'ai').toLowerCase()}`,
  };
}

/**
 * Intelligent Job Application Email Generation Agent using LLM
 */
export async function performLlmEmailGeneration({
  jobTitle = '',
  companyName = '',
  recipientEmail = '',
  requirements = '',
  description = '',
  resumeContent = '',
  atsReport = null,
  profile = {},
  provider = 'OpenAI',
  apiKey = '',
  model = '',
}) {
  const candidateName = profile?.fullName || profile?.name || 'Applicant';
  const headline = profile?.headline || '';
  const candidateEmail = profile?.email || '';
  const phone = profile?.phone || '';
  const portfolio = profile?.portfolio || '';
  const linkedin = profile?.linkedin || '';
  const github = profile?.github || '';

  const links = [
    portfolio ? `Portfolio: ${portfolio}` : '',
    github ? `GitHub: ${github}` : '',
    linkedin ? `LinkedIn: ${linkedin}` : '',
  ].filter(Boolean).join(' | ');

  const contactBlock = [
    candidateEmail,
    phone,
    links,
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are an elite career strategist and executive application ghostwriter.
Generate a high-converting, professional, tailored job application email from ${candidateName} to ${companyName || 'the hiring team'} for the position of "${jobTitle}".

CRITICAL INSTRUCTIONS:
1. Subject line must be crisp, professional, and include candidate name and role (e.g. "Application: ${jobTitle} - ${candidateName}").
2. The email body must be concise, punchy (150-250 words), and tailored directly to the company's stated requirements.
3. Hook the reader in the opening line with specific value—never use stale clichés like "I am writing to express my eager interest".
4. Reference 2-3 specific matching competencies, tools, and quantified outcomes from the candidate's background.
5. End with a polite, confident call to action regarding an interview, and include the candidate's professional sign-off and links.

Your output MUST be strict valid JSON with no markdown wrapping:
{
  "subject": "<subject line>",
  "body": "<complete email body text>",
  "generatedEmail": "Subject: <subject line>\\n\\n<complete email body text>"
}`;

  const userContent = `TARGET JOB:
Role: ${jobTitle}
Company: ${companyName || 'Hiring Company'}
Recipient: ${recipientEmail || 'Hiring Manager'}
Requirements: ${requirements}
Description: ${description}

CANDIDATE BACKGROUND:
Name: ${candidateName}
Headline: ${headline}
Contact:
${contactBlock}

Resume Highlights:
${resumeContent ? resumeContent.slice(0, 3000) : 'Technical professional with verified experience in this field.'}

ATS Matched Competencies: ${(atsReport?.matchedSkills || []).join(', ') || 'Relevant software & technical expertise'}`;

  const responseText = await callLlmCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.35,
    responseFormat: 'json_object',
  });

  let cleanJson = responseText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleanJson);
  const subject = parsed.subject || `Application: ${jobTitle} - ${candidateName}`;
  const body = parsed.body || '';
  const generatedEmail = parsed.generatedEmail || `Subject: ${subject}\n\n${body}`;

  return {
    success: true,
    subject,
    body,
    generatedEmail,
    source: `llm-${(provider || 'ai').toLowerCase()}`,
  };
}

