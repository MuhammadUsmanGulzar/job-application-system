/**
 * AI Service for generating custom job application emails / cover letters
 * using OpenAI or compatible LLM APIs.
 */

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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`;
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
      const err = await response.text();
      throw new Error(`Gemini API Error: ${err}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No content generated.';
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
