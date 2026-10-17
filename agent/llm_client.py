import json
import re
from typing import Optional, Dict, Any
import httpx

PROVIDER_DEFAULTS = {
    "Gemini": "gemini-1.5-flash",
    "OpenAI": "gpt-4o-mini",
    "Groq": "llama-3.3-70b-versatile",
}

def call_user_llm(
    prompt: str,
    system_prompt: str = "",
    provider: str = "OpenAI",
    api_key: str = "",
    model: str = "",
    temperature: float = 0.2,
    json_mode: bool = False,
    timeout: float = 25.0,
) -> str:
    """
    Calls the user's configured LLM provider directly via standard HTTP REST API.
    Supports Google Gemini, OpenAI, and Groq with optional structured JSON mode.
    """
    if not api_key or not api_key.strip():
        raise ValueError("Missing user LLM API key.")

    key = api_key.strip()
    norm_provider = (provider or "OpenAI").strip().lower()
    selected_model = (model or "").strip()

    if "gemini" in norm_provider or "google" in norm_provider:
        target_model = selected_model or PROVIDER_DEFAULTS["Gemini"]
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={key}"
        
        body: Dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": temperature,
            },
        }

        if system_prompt:
            body["systemInstruction"] = {
                "role": "system",
                "parts": [{"text": system_prompt}],
            }

        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"

        with httpx.Client(timeout=timeout) as client:
            resp = client.post(endpoint, json=body)
            if not resp.is_success:
                raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            candidates = data.get("candidates") or []
            if candidates:
                first = candidates[0]
                parts = first.get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
            raise RuntimeError("Gemini API returned empty candidate response.")

    elif "groq" in norm_provider:
        target_model = selected_model or PROVIDER_DEFAULTS["Groq"]
        endpoint = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        with httpx.Client(timeout=timeout) as client:
            resp = client.post(endpoint, json=body, headers=headers)
            if not resp.is_success:
                raise RuntimeError(f"Groq API returned {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            choices = data.get("choices") or []
            if choices:
                return choices[0].get("message", {}).get("content", "").strip()
            raise RuntimeError("Groq API returned empty choice response.")

    else:
        # Default: OpenAI
        target_model = selected_model or PROVIDER_DEFAULTS["OpenAI"]
        endpoint = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        with httpx.Client(timeout=timeout) as client:
            resp = client.post(endpoint, json=body, headers=headers)
            if not resp.is_success:
                raise RuntimeError(f"OpenAI API returned {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            choices = data.get("choices") or []
            if choices:
                return choices[0].get("message", {}).get("content", "").strip()
            raise RuntimeError("OpenAI API returned empty choice response.")


def parse_json_from_llm_response(text: str) -> Dict[str, Any]:
    """
    Cleans markdown code fences (```json ... ```) and parses JSON cleanly.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned.strip())
