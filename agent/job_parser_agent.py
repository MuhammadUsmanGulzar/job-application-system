import re
import unicodedata
import os
from typing import Optional, List
from typing_extensions import TypedDict
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client
from langgraph.graph import StateGraph, START, END
from llm_client import call_user_llm, parse_json_from_llm_response

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://msyzzsoiuzwwsksfvddj.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
N8N_WEBHOOK_URL = os.getenv(
    "N8N_WEBHOOK_URL",
    "https://n8n.flyinvict.com/webhook/8c9fe40a-79bb-49b7-9bdf-e9bba8bae6cc"
)

def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# -----------------------------------------------------------------------------
# AGENT STATE
# -----------------------------------------------------------------------------

class JobParserState(TypedDict, total=False):
    raw_text: str
    user_id: str
    
    # Normalized & extracted fields
    normalized_text: str
    company_name: Optional[str]
    job_title: Optional[str]
    recipient_email: Optional[str]
    requirements: Optional[str]
    description: Optional[str]

    # LLM Settings
    llm_provider: Optional[str]
    llm_api_key: Optional[str]
    llm_model: Optional[str]
    
    # Outcomes
    application_id: Optional[str]
    save_to_db: bool
    send_webhook: bool
    webhook_sent: bool
    status: str  # "STARTING" | "PARSED" | "SAVED" | "WEBHOOK_TRIGGERED" | "FAILED"
    error: Optional[str]
    logs: List[str]


# -----------------------------------------------------------------------------
# GRAPH NODES
# -----------------------------------------------------------------------------

def normalize_text_node(state: JobParserState) -> JobParserState:
    """Node 1: Normalizes unicode formatting (bold/italic/monospace math chars) into ASCII."""
    logs = state.get("logs", [])
    raw = state.get("raw_text", "")
    
    if not raw or not raw.strip():
        return {
            **state,
            "status": "FAILED",
            "error": "Raw job posting text is empty.",
            "logs": logs + ["Error: Raw text is empty."],
        }

    # Convert mathematical unicode bold/sans chars (like 𝗔𝗜 𝗘𝘅𝗽𝗲𝗿𝘁) to plain ASCII
    normalized = unicodedata.normalize("NFKD", raw)
    
    # Normalize bullet points and weird spaces
    normalized = normalized.replace("•", "\n• ").replace("·", "\n· ")
    
    logs.append(f"Normalized text (length: {len(normalized)} chars)")
    return {
        **state,
        "normalized_text": normalized,
        "status": "NORMALIZED",
        "logs": logs,
    }


def is_valid_company_name(name: str) -> bool:
    if not name or not isinstance(name, str):
        return False
    trimmed = name.strip()
    if len(trimmed) < 2 or len(trimmed) > 35:
        return False
    blacklist = [
        "ai integration", "hiring company", "on-site", "remote", "hybrid", "location",
        "our client", "the moment", "least", "first", "our team", "the team", "and", "with",
        "grow your career", "career", "python", "we", "us", "who", "fast-growing"
    ]
    if any(b in trimmed.lower() for b in blacklist):
        return False
    if re.match(r"^(?:and|or|the|a|an|in|on|at|to|for|with|by|our)\b", trimmed, re.IGNORECASE):
        return False
    return True


def extract_job_details_node(state: JobParserState) -> JobParserState:
    """Node 2: Extracts Job Title, Company Name, Recipient Email, Requirements, and Description."""
    logs = state.get("logs", [])
    text = state["normalized_text"]

    # 0. Direct User LLM Extraction if API key is provided
    llm_api_key = (state.get("llm_api_key") or "").strip()
    if llm_api_key:
        try:
            prompt = f"""You are an expert recruitment parser. Analyze this raw job posting text and extract structured recruitment data.
Return ONLY valid JSON matching this schema:
{{
  "jobTitle": "Exact professional job title (e.g. AI Expert, Senior React Developer)",
  "companyName": "Clean company name without filler words",
  "recipientEmail": "Application submission email or HR contact email (empty string if none)",
  "requirements": "Key qualifications, required skills, and core responsibilities formatted as clean bullet points",
  "description": "Clean summary of role scope, expectations, and benefits"
}}

Raw Job Posting:
\"\"\"{text}\"\"\"
"""
            raw_json = call_user_llm(
                prompt=prompt,
                system_prompt="You extract job postings into clean, structured JSON format with zero conversational filler.",
                provider=state.get("llm_provider", "OpenAI"),
                api_key=llm_api_key,
                model=state.get("llm_model", ""),
                temperature=0.1,
                json_mode=True,
            )
            parsed = parse_json_from_llm_response(raw_json)
            if parsed.get("jobTitle"):
                logs.append(f"Successfully extracted job fields via user's LLM ({state.get('llm_provider', 'OpenAI')})")
                return {
                    **state,
                    "job_title": parsed.get("jobTitle", "Software Engineer"),
                    "company_name": parsed.get("companyName", "Hiring Company"),
                    "recipient_email": parsed.get("recipientEmail", ""),
                    "requirements": parsed.get("requirements", ""),
                    "description": parsed.get("description", text.strip()),
                    "status": "PARSED",
                    "logs": logs,
                }
        except Exception as e:
            logs.append(f"User LLM parsing note: {str(e)}. Falling back to rule-based engine.")

    # 1. Extract Email
    email_match = re.search(
        r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:com|org|net|co\.uk|co|io|pk|edu|gov|tech|ai|dev|global)",
        text,
        re.IGNORECASE,
    )
    recipient_email = email_match.group(0).strip() if email_match else ""

    # 2. Extract Company Name
    company_name = ""
    # Markdown link: [Company](url)
    markdown_company = re.search(r"\[([^\]]+)\]\(https?://[^\)]+\)", text)
    if markdown_company and is_valid_company_name(markdown_company.group(1)):
        company_name = markdown_company.group(1).strip()

    # "Company is hiring / looking for"
    if not company_name:
        is_hiring_match = re.search(r"([A-Z][A-Za-z0-9&.\s]{1,30})\s+(?:is\s+(?:hiring|looking for|seeking))", text, re.IGNORECASE)
        if is_hiring_match and is_valid_company_name(is_hiring_match.group(1)):
            company_name = is_hiring_match.group(1).strip()

    # "Join Company", "welcome to Company"
    if not company_name:
        join_match = re.search(r"(?:join|joining|welcome to)\s+([A-Z][A-Za-z0-9&.\s]{2,25})", text, re.IGNORECASE)
        if join_match and is_valid_company_name(join_match.group(1)):
            company_name = join_match.group(1).strip()

    # "at Company", "company: Company"
    if not company_name:
        comp_match = re.search(r"(?:at|company:?|organization:?)\s+([A-Z][A-Za-z0-9&.\s]{2,25})", text)
        if comp_match and is_valid_company_name(comp_match.group(1)):
            company_name = comp_match.group(1).strip()

    # Fallback: Check recipient email domain (e.g. hr@neuralige.com -> Neuralige)
    if (not company_name or company_name.lower() == "hiring company") and recipient_email:
        parts = recipient_email.split("@")
        if len(parts) == 2:
            domain = parts[1].lower().strip()
            domain_name = domain.split(".")[0]
            generic_domains = ["gmail", "yahoo", "hotmail", "outlook", "icloud", "proton", "mail"]
            if domain_name and domain_name not in generic_domains:
                company_name = domain_name.capitalize()

    if not company_name:
        company_name = "Hiring Company"

    # 3. Extract Job Title
    job_title = ""
    # Check explicit hiring headline first: e.g. "We’re Hiring: Associate Software Engineer (Python & AI)"
    hiring_header_match = re.search(r"(?:we['’]?re\s+hiring|hiring|opening|job\s+opportunity)[:\s]+([^\n\r.]+)", text, re.IGNORECASE)
    if hiring_header_match:
        job_title = hiring_header_match.group(1).strip()

    if not job_title:
        title_match = re.search(
            r"(?:looking for|hiring(?:\s+for)?|position(?:\s+of)?|role(?:\s+of)?|opening for)\s+([A-Za-z0-9\s()\/,+-]+?)(?=(?:\s+On-Site|\s+Remote|\s+Hybrid|\s+Location|Key Responsibilities|Responsibilities|Requirements|\.|\n|$))",
            text,
            re.IGNORECASE,
        )
        if title_match:
            job_title = title_match.group(1).strip()

    known_role_match = re.search(
        r"\b(?:Senior|Junior|Lead|Associate|Staff|Principal)?\s*(?:Software Engineer|Software Developer|Full[- ]?Stack Developer|Frontend Developer|Backend Developer|Python Developer|AI Engineer|AI Expert|Machine Learning Engineer|Data Scientist|Data Analyst|DevOps Engineer|QA Engineer|Mobile Developer|React Developer|Node\.js Developer)\b",
        text,
        re.IGNORECASE,
    )

    if job_title:
        # Cut off qualification clauses like 'with a strong foundation...', 'who...', 'having...'
        job_title = re.split(r"\s+(?:with|who|having|to join|responsible for|seeking)\b", job_title, flags=re.IGNORECASE)[0].strip()
        # Strip leading filler adjectives like 'an enthusiastic', 'a skilled', etc.
        job_title = re.sub(r"^(?:an?|the)\s+(?:enthusiastic|motivated|passionate|experienced|talented|skilled|dynamic|exceptional|energetic|dedicated|driven|seasoned)?\s*", "", job_title, flags=re.IGNORECASE).strip()
        # Strip trailing punctuation
        job_title = re.sub(r"[,;:-]+$", "", job_title).strip()

    if (not job_title or len(job_title) > 50) and known_role_match:
        job_title = known_role_match.group(0).strip()
    elif known_role_match and known_role_match.group(0).lower() in job_title.lower():
        if len(job_title) > len(known_role_match.group(0)) + 35:
            job_title = known_role_match.group(0).strip()

    if not job_title:
        first_line = text.split("\n")[0]
        job_title = first_line[:50].strip()

    # 4. Extract Requirements & Responsibilities
    requirements = ""
    req_match = re.search(
        r"(?:Key Responsibilities|Responsibilities|Required Skills|Requirements)[:\s]*(.*?)(?=(?:Apply at|Location|Whatsapp|Salary|How to Apply|$))",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if req_match:
        requirements = req_match.group(1).strip()
    else:
        requirements = text[:400]

    # Clean description (original text cleaned)
    description = text.strip()

    logs.append(f"Extracted: Title='{job_title}', Company='{company_name}', Email='{recipient_email}'")

    return {
        **state,
        "job_title": job_title or "Software Engineer",
        "company_name": company_name or "Hiring Company",
        "recipient_email": recipient_email,
        "requirements": requirements,
        "description": description,
        "status": "PARSED",
        "logs": logs,
    }


def save_application_node(state: JobParserState) -> JobParserState:
    """Node 3: Creates an application record in Supabase only if save_to_db is True."""
    logs = state.get("logs", [])
    user_id = state.get("user_id")

    if not state.get("save_to_db", False) or not user_id:
        logs.append("Skipping database save (parse-only mode or no user_id).")
        return {**state, "logs": logs}

    try:
        supabase = get_supabase_client()
        app_record = {
            "user_id": user_id,
            "job_title": state.get("job_title") or "Software Developer",
            "company_name": state.get("company_name") or "Hiring Company",
            "recipient_email": state.get("recipient_email") or "",
            "requirements": state.get("requirements") or "",
            "description": state.get("description") or "",
            "status": "Generating",
        }

        res = supabase.table("applications").insert(app_record).execute()
        if res.data and len(res.data) > 0:
            app_id = res.data[0]["id"]
            logs.append(f"Created application record in Supabase: ID={app_id}")
            return {**state, "application_id": app_id, "status": "SAVED", "logs": logs}
        else:
            logs.append("Warning: Supabase returned empty insert data.")
            return {**state, "logs": logs}

    except Exception as e:
        logs.append(f"Database save error: {str(e)}")
        return {**state, "error": str(e), "logs": logs}


def dispatch_to_n8n_node(state: JobParserState) -> JobParserState:
    """Node 4: Forwards the structured job payload to the n8n webhook only if send_webhook is True."""
    logs = state.get("logs", [])

    if not state.get("send_webhook", False):
        logs.append("Skipping n8n dispatch (send_webhook is False).")
        return {**state, "logs": logs}

    user_id = state.get("user_id", "")
    app_id = state.get("application_id", "")

    payload = {
        "userID": user_id,
        "user_id": user_id,
        "applicationID": app_id,
        "application_id": app_id,
        "jobTitle": state.get("job_title"),
        "job_title": state.get("job_title"),
        "companyName": state.get("company_name"),
        "company_name": state.get("company_name"),
        "recipientEmail": state.get("recipient_email"),
        "recipient_email": state.get("recipient_email"),
        "requirements": state.get("requirements"),
        "description": state.get("description"),
    }

    try:
        logs.append(f"Dispatching payload to n8n webhook: {N8N_WEBHOOK_URL}")
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(N8N_WEBHOOK_URL, json=payload)
            logs.append(f"n8n webhook response status: {resp.status_code}")

        return {
            **state,
            "webhook_sent": True,
            "status": "WEBHOOK_TRIGGERED",
            "logs": logs,
        }
    except Exception as e:
        logs.append(f"Webhook dispatch warning: {str(e)}")
        return {
            **state,
            "webhook_sent": False,
            "error": f"Failed to trigger n8n: {str(e)}",
            "logs": logs,
        }


def handle_error_node(state: JobParserState) -> JobParserState:
    logs = state.get("logs", [])
    err = state.get("error", "Unknown error in parsing agent")
    logs.append(f"Agent stopped with error: {err}")
    return {**state, "status": "FAILED", "logs": logs}


def route_after_norm(state: JobParserState) -> str:
    return "handle_error" if state.get("status") == "FAILED" else "extract_details"


# -----------------------------------------------------------------------------
# COMPILE GRAPH
# -----------------------------------------------------------------------------

def build_job_parser_agent():
    workflow = StateGraph(JobParserState)

    workflow.add_node("normalize_text", normalize_text_node)
    workflow.add_node("extract_details", extract_job_details_node)
    workflow.add_node("save_application", save_application_node)
    workflow.add_node("dispatch_to_n8n", dispatch_to_n8n_node)
    workflow.add_node("handle_error", handle_error_node)

    workflow.add_edge(START, "normalize_text")
    workflow.add_conditional_edges("normalize_text", route_after_norm, {
        "extract_details": "extract_details",
        "handle_error": "handle_error"
    })
    workflow.add_edge("extract_details", "save_application")
    workflow.add_edge("save_application", "dispatch_to_n8n")
    workflow.add_edge("dispatch_to_n8n", END)
    workflow.add_edge("handle_error", END)

    return workflow.compile()

job_parser_agent = build_job_parser_agent()
