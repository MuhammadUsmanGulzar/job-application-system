/**
 * AI Service for generating custom job application emails / cover letters
 * using OpenAI, Gemini, or Groq LLM APIs.
 */

export const LLM_PROVIDERS_CONFIG = {
  OpenAI: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Cost-Effective)' },
      { id: 'gpt-4o', label: 'GPT-4o (High Intelligence & Complex Jobs)' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    placeholder: 'sk-proj-... or sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  Gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-1.5-flash',
    models: [
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Super Fast)' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Deep Context)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Next Gen)' },
    ],
    placeholder: 'AIzaSy...',
    helpUrl: 'https://aistudio.google.com/app/apikey',
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

export async function generateJobApplication({
  jobTitle,
  companyName,
  recipientEmail,
  requirements,
  description,
  resumeContent,
  resumeName,
  apiKey,
  model = 'gpt-4o-mini',
  provider = 'OpenAI',
}) {
  if (!apiKey) {
    throw new Error('Please enter your LLM API Key in Settings first.');
  }

  const prompt = `You are a professional career coach and executive copywriter. Write a highly persuasive, tailored, and professional job application email/cover letter.

JOB DETAILS:
- Title: ${jobTitle || 'N/A'}
- Company: ${companyName || 'Hiring Team'}
- Recipient / Recruiter Email: ${recipientEmail || 'N/A'}
- Requirements: ${requirements || 'N/A'}
- Description: ${description || 'N/A'}

CANDIDATE RESUME / BACKGROUND:
${resumeContent ? resumeContent : 'Candidate with strong engineering and analytical experience.'}

INSTRUCTIONS:
1. Write a compelling Subject line for the email.
2. Address the hiring manager or recruiter professionally.
3. Highlight the candidate's exact strengths and how they map to the job's requirements.
4. Keep the tone confident, articulate, and concise (not overly verbose).
5. Include a clear call to action proposing a quick introductory chat or interview.
6. Format the output clearly with:
   Subject: [Your Subject Line]

   [Body of the email]
`;

  if (provider === 'OpenAI' || !provider) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert executive career strategist who crafts bespoke, high-converting job applications and cover emails.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate email with OpenAI API.';
      try {
        const errorData = await response.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // ignore json parse error
      }
      throw new Error(`OpenAI API Error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No content generated.';
  } else if (provider === 'Gemini') {
    // Google Gemini API
    const targetModel = model || 'gemini-1.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey.trim()}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate email with Gemini API.';
      try {
        const errorData = await response.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // ignore
      }
      throw new Error(`Gemini API Error: ${errorMessage}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No content generated.';
  } else if (provider === 'Groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an expert executive career strategist who crafts bespoke, high-converting job applications and cover emails.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate email with Groq API.';
      try {
        const errorData = await response.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // ignore
      }
      throw new Error(`Groq API Error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No content generated.';
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
