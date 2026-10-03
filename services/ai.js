/**
 * AI Service Configuration & Types
 * 
 * NOTE: Frontend is strictly for visuals and data input.
 * Direct client-side calls to LLM APIs (OpenAI, Gemini, Groq) are disabled for security
 * and architectural design. All AI generation is executed on the backend (n8n workflow).
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
    placeholder: 'Configured securely in backend',
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
    placeholder: 'Configured securely in backend',
    helpUrl: 'https://aistudio.google.com/app/apikey',
  },
  Groq: {
    name: 'Groq (Llama 3)',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile & Free Tier)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Ultra Fast)' },
    ],
    placeholder: 'Configured securely in backend',
    helpUrl: 'https://console.groq.com/keys',
  },
};

/**
 * Direct client-side LLM call safeguard.
 * Ensures the frontend cannot call third-party LLM APIs directly.
 */
export async function generateJobApplication() {
  throw new Error(
    'Direct client-side LLM API calls are disabled. Generation is executed on the backend.'
  );
}

