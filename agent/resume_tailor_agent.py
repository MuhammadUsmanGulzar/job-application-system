import os
import io
import html
import re
import unicodedata
from typing import Any, Dict, Optional, List
from typing_extensions import TypedDict
from dotenv import load_dotenv
from supabase import create_client, Client
from langgraph.graph import StateGraph, START, END
from llm_client import call_user_llm, parse_json_from_llm_response

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://msyzzsoiuzwwsksfvddj.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required in environment.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _filename_part(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", normalized).strip("_")
    normalized = re.sub(r"_+", "_", normalized)
    return normalized or fallback


def _role_filename_variants(job_title: str) -> List[str]:
    original = _filename_part(job_title, "Professional")
    readable = original.replace("_", " ")
    variants = [original]

    if re.search(r"\b(?:AI|Artificial Intelligence|Agentic AI)\b", readable, re.I):
        variants.extend(["AI_Engineer", "Agentic_AI_Developer", "AI_Developer", "AI_Specialist"])
    if re.search(r"\bEngineer\b", readable, re.I):
        variants.append(_filename_part(re.sub(r"\bEngineer\b", "Developer", readable, count=1, flags=re.I), "Developer"))
    if re.search(r"\bDeveloper\b", readable, re.I):
        variants.append(_filename_part(re.sub(r"\bDeveloper\b", "Engineer", readable, count=1, flags=re.I), "Engineer"))

    variants.extend([f"{original}_Specialist", f"{original}_Professional"])
    return list(dict.fromkeys(_filename_part(value, "Professional") for value in variants))


def _tailored_resume_filename(
    supabase: Client,
    user_id: str,
    full_name: str,
    job_title: str,
    raw_resume: str = "",
) -> str:
    first_line = next((line.strip() for line in (raw_resume or "").splitlines() if line.strip()), "")
    candidate_name = _filename_part(full_name or first_line, "Candidate")
    role_variants = _role_filename_variants(job_title)
    existing_names = set()

    try:
        result = supabase.from_("resumes").select("file_name").eq("user_id", user_id).execute()
        existing_names.update(
            str(row.get("file_name") or "").lower()
            for row in (result.data or [])
            if row.get("file_name")
        )
    except Exception:
        pass

    try:
        existing_names.update(
            str(item.get("name") or "").lower()
            for item in (supabase.storage.from_("resumes").list(user_id) or [])
            if item.get("name")
        )
    except Exception:
        pass

    for role in role_variants:
        file_name = f"{candidate_name}_{role}.pdf"
        if file_name.lower() not in existing_names:
            return file_name

    version = 2
    while f"{candidate_name}_{role_variants[0]}_{version}.pdf".lower() in existing_names:
        version += 1
    return f"{candidate_name}_{role_variants[0]}_{version}.pdf"


# -----------------------------------------------------------------------------
# STATE DEFINITION
# -----------------------------------------------------------------------------

class ResumeTailorState(TypedDict, total=False):
    user_id: str
    job_title: str
    company_name: Optional[str]
    requirements: Optional[str]
    job_description: Optional[str]
    raw_resume: Optional[str]
    resume_name: Optional[str]
    save_to_db: bool
    ats_report: Dict[str, Any]
    llm_provider: Optional[str]
    llm_api_key: Optional[str]
    llm_model: Optional[str]
    full_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    location: Optional[str]
    linkedin: Optional[str]
    github: Optional[str]
    portfolio: Optional[str]
    pdf_file_path: Optional[str]
    pdf_url: Optional[str]
    
    # Processed Fields
    extracted_keywords: List[str]
    matched_skills: List[str]
    missing_skills: List[str]
    tailored_resume: str
    enhancements: List[str]
    
    # Status & Logging
    status: str  # "STARTING" | "LOADED" | "ANALYZED" | "TAILORED" | "SAVED" | "FAILED"
    error: Optional[str]
    logs: List[str]


# -----------------------------------------------------------------------------
# SUPABASE STORAGE BUCKET RESUME EXTRACTOR
# -----------------------------------------------------------------------------

def extract_resume_from_bucket(user_id: str, supabase_client: Optional[Client] = None) -> tuple[str, str]:
    """
    Downloads the user's latest resume from Supabase Storage bucket 'resumes/{user_id}/',
    extracts text (using pypdf if PDF), and returns (file_name, extracted_text).
    Also updates user_settings so the database stays up to date.
    """
    if not user_id:
        return "", ""
    
    supabase = supabase_client or get_supabase_client()
    try:
        files = supabase.storage.from_("resumes").list(user_id)
        if not files:
            return "", ""
        
        # Filter out folder placeholders
        real_files = [f for f in files if f.get("name") and not f.get("name").endswith("/")]
        if not real_files:
            return "", ""
        
        # Prefer the user's uploaded master resume over generated job-specific copies.
        source_files = [f for f in real_files if not re.match(r"resume[_-]?tailored", f.get("name", ""), re.I)]
        candidates = source_files or real_files
        candidates.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or "", reverse=True)
        chosen_file = candidates[0]
        file_name = chosen_file["name"]
        file_path = f"{user_id}/{file_name}"

        file_bytes = supabase.storage.from_("resumes").download(file_path)
        extracted_text = ""

        if file_name.lower().endswith(".pdf"):
            import io
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    extracted_text += page_text + "\n"
        elif file_name.lower().endswith((".txt", ".md", ".json", ".rtf")):
            extracted_text = file_bytes.decode("utf-8", errors="ignore")
        elif file_name.lower().endswith((".doc", ".docx")):
            try:
                import io, docx
                doc = docx.Document(io.BytesIO(file_bytes))
                extracted_text = "\n".join([p.text for p in doc.paragraphs if p.text])
            except Exception:
                extracted_text = file_bytes.decode("latin-1", errors="ignore")
        else:
            extracted_text = file_bytes.decode("utf-8", errors="ignore")

        extracted_text = extracted_text.strip()
        if extracted_text:
            # Sync to user_settings table
            try:
                supabase.table("user_settings").update({
                    "resume_name": file_name,
                    "resume_content": extracted_text,
                }).eq("user_id", user_id).execute()
            except Exception:
                pass
            
            # Sync to resumes table
            try:
                supabase.table("resumes").upsert({
                    "user_id": user_id,
                    "file_name": file_name,
                    "file_path": file_path,
                    "parsed_text": extracted_text,
                    "is_primary": True,
                }, on_conflict="user_id,file_path").execute()
            except Exception:
                pass

        return file_name, extracted_text
    except Exception as e:
        print(f"Error extracting resume from bucket for user {user_id}: {e}")
        return "", ""


# -----------------------------------------------------------------------------
# GRAPH NODES
# -----------------------------------------------------------------------------

def load_user_resume_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 1: Loads the user's existing resume content from state or Supabase.
    If no resume exists, constructs a strong initial template using the user profile.
    """
    logs = list(state.get("logs", []))
    user_id = state.get("user_id", "").strip()
    raw_resume = state.get("raw_resume", "").strip()
    resume_name = state.get("resume_name", "")

    logs.append(f"Starting Resume Tailor Agent for User: {user_id or 'Guest'}")

    if raw_resume:
        logs.append(f"Using provided raw resume content ({len(raw_resume)} chars)")
        return {
            **state,
            "raw_resume": raw_resume,
            "resume_name": resume_name or "Resume.txt",
            "status": "LOADED",
            "logs": logs,
        }

    # If no raw resume provided in payload, attempt retrieval from Supabase
    if user_id:
        try:
            supabase = get_supabase_client()
            logs.append(f"Querying user_settings for resume content of user: {user_id}...")

            # 1. Check user_settings
            res = (
                supabase.from_("user_settings")
                .select("resume_name, resume_content")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )

            if res.data and res.data.get("resume_content"):
                raw_resume = res.data["resume_content"]
                resume_name = res.data.get("resume_name") or "Resume.txt"
                logs.append(f"Found active resume in user_settings: '{resume_name}' ({len(raw_resume)} chars)")
                return {
                    **state,
                    "raw_resume": raw_resume,
                    "resume_name": resume_name,
                    "status": "LOADED",
                    "logs": logs,
                }

            # 2. Check Supabase Storage Bucket 'resumes/{user_id}/'
            logs.append(f"Checking Supabase Storage Bucket 'resumes/{user_id}/'...")
            bucket_fname, bucket_text = extract_resume_from_bucket(user_id, supabase)
            if bucket_text:
                logs.append(f"Successfully loaded and extracted resume from bucket: '{bucket_fname}' ({len(bucket_text)} chars)")
                return {
                    **state,
                    "raw_resume": bucket_text,
                    "resume_name": bucket_fname,
                    "status": "LOADED",
                    "logs": logs,
                }

            # 3. Check public.resumes table
            res_table = (
                supabase.from_("resumes")
                .select("file_name, parsed_text")
                .eq("user_id", user_id)
                .eq("is_primary", True)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if res_table.data and len(res_table.data) > 0 and res_table.data[0].get("parsed_text"):
                raw_resume = res_table.data[0]["parsed_text"]
                resume_name = res_table.data[0].get("file_name") or "Resume.txt"
                logs.append(f"Found resume in public.resumes: '{resume_name}'")
                return {
                    **state,
                    "raw_resume": raw_resume,
                    "resume_name": resume_name,
                    "status": "LOADED",
                    "logs": logs,
                }

            return {
                **state,
                "status": "FAILED",
                "error": "No source resume was found. Upload a resume before running the tailoring agent so it cannot invent experience or credentials.",
                "logs": logs,
            }

        except Exception as e:
            logs.append(f"Supabase resume load warning: {str(e)}")

    return {
        **state,
        "status": "FAILED",
        "error": "No source resume was provided. Upload a resume before running the tailoring agent.",
        "logs": logs,
    }


def analyze_requirements_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 2: Extracts technical keywords, soft skills, and requirements from the target job posting.
    """
    if state.get("status") == "FAILED":
        return state
    logs = list(state.get("logs", []))
    req_text = (state.get("requirements") or "") + " " + (state.get("job_description") or "") + " " + (state.get("job_title") or "")
    
    # Normalize unicode characters
    req_text = unicodedata.normalize("NFKD", req_text)

    # Common technical skills and tools dictionary
    tech_keywords_catalog = [
        "Python", "JavaScript", "TypeScript", "React", "React Native", "Next.js", "Node.js", "Express",
        "FastAPI", "Django", "Flask", "LangGraph", "LangChain", "OpenAI", "ChatGPT", "Claude", "Gemini",
        "LLMs", "Generative AI", "AI Agents", "Prompt Engineering", "n8n", "Make", "Zapier", "Automations",
        "PostgreSQL", "Supabase", "MongoDB", "MySQL", "Redis", "Docker", "Kubernetes", "AWS", "GCP",
        "Git", "GitHub", "REST APIs", "GraphQL", "CI/CD", "SEO", "Digital Marketing", "Computer Science",
        "Software Engineering", "Unit Testing", "Debugging", "Data Science", "Machine Learning", "NLP"
    ]

    extracted_keywords = []
    for kw in tech_keywords_catalog:
        pattern = r"\b" + re.escape(kw) + r"\b"
        if re.search(pattern, req_text, re.IGNORECASE):
            extracted_keywords.append(kw)

    # Also capture bullet points or lines under Requirements
    bullets = re.findall(r"(?:•|\*|-|\d+\.)\s*([A-Za-z0-9\s,./()+-]{3,50})", req_text)
    for b in bullets:
        clean_b = b.strip()
        if len(clean_b) > 4 and clean_b not in extracted_keywords:
            if not any(k.lower() in clean_b.lower() for k in ["apply", "whatsapp", "location", "salary", "shift", "on-site"]):
                extracted_keywords.append(clean_b)

    # Deduplicate while preserving case
    seen = set()
    unique_keywords = []
    for kw in extracted_keywords:
        if kw.lower() not in seen:
            seen.add(kw.lower())
            unique_keywords.append(kw)

    logs.append(f"Extracted {len(unique_keywords)} key skills/requirements: {', '.join(unique_keywords[:8])}")

    return {
        **state,
        "extracted_keywords": unique_keywords,
        "status": "ANALYZED",
        "logs": logs,
    }


_SECTION_PATTERNS = [
    ("summary", re.compile(r"^(professional\s+summary|summary|profile|about(?:\s+me)?)$", re.I)),
    ("skills", re.compile(r"^(core\s+competencies(?:\s*&\s*technical\s+skills)?|technical\s+skills|skills|key\s+skills|competencies)$", re.I)),
    ("experience", re.compile(r"^(professional\s+experience|work\s+experience|experience|employment\s+history|work\s+history)$", re.I)),
    ("projects", re.compile(r"^(selected\s+.*projects|projects(?:\s*&\s*technical\s+highlights)?|key\s+projects)$", re.I)),
    ("education", re.compile(r"^(education(?:\s*&\s*credentials)?|academic\s+background|qualifications)$", re.I)),
    ("certifications", re.compile(r"^(certifications?|licenses?\s*&\s*certifications?)$", re.I)),
    ("achievements", re.compile(r"^(achievements?|awards?)$", re.I)),
]


def _section_kind(line: str) -> str:
    clean = (line or "").strip().rstrip(":")
    for kind, pattern in _SECTION_PATTERNS:
        if pattern.fullmatch(clean):
            return kind
    return ""


def _parse_resume_structure(text: str) -> tuple[List[str], List[Dict[str, Any]]]:
    header: List[str] = []
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        kind = _section_kind(line)
        if not kind and current is not None and re.fullmatch(r"[A-Z][A-Z\s&/+\-]{2,60}", line or ""):
            kind = f"other:{line.lower()}"
        if kind:
            current = {"kind": kind, "heading": line, "body": []}
            sections.append(current)
        elif current is not None:
            if line or current["body"]:
                current["body"].append(line)
        elif line:
            header.append(line)
    return header, sections


def _is_bullet(line: str) -> bool:
    return bool(re.match(r"^[-•*]\s*", (line or "").strip()))


def _safe_experience_bullet(original: str, revised: str) -> str:
    if not revised:
        return original
    clean = re.sub(r"^[-•*]\s*", "", revised).strip()
    original_clean = re.sub(r"^[-•*]\s*", "", original).strip()
    if not clean or len(clean) > max(int(len(original_clean) * 1.65), len(original_clean) + 80):
        return original
    original_numbers = re.findall(r"\b\d[\d,.]*%?\b", original_clean)
    revised_numbers = re.findall(r"\b\d[\d,.]*%?\b", clean)
    if any(value not in original_numbers for value in revised_numbers):
        return original
    prefix_match = re.match(r"^[-•*]", original.strip())
    return f"{prefix_match.group(0) if prefix_match else '-'} {clean}"


def enforce_resume_fidelity(source_resume: str, ai_draft: str) -> str:
    """Restore immutable facts and allow edits only to summary, skills, and experience bullets."""
    source_header, source_sections = _parse_resume_structure(source_resume)
    _, draft_sections = _parse_resume_structure(ai_draft)
    if not source_header or not source_sections:
        return (source_resume or ai_draft).strip()
    draft_by_kind = {section["kind"]: section for section in draft_sections}
    output = [*source_header, ""]
    for index, section in enumerate(source_sections):
        candidate = draft_by_kind.get(section["kind"])
        body = list(section["body"])
        if section["kind"] in ("summary", "skills") and candidate and any(candidate["body"]):
            body = list(candidate["body"])
        elif section["kind"] == "experience" and candidate:
            candidate_bullets = [line for line in candidate["body"] if _is_bullet(line)]
            bullet_index = 0
            merged = []
            for line in body:
                if _is_bullet(line):
                    revised = candidate_bullets[bullet_index] if bullet_index < len(candidate_bullets) else ""
                    merged.append(_safe_experience_bullet(line, revised))
                    bullet_index += 1
                else:
                    merged.append(line)
            body = merged
        output.extend([section["heading"], *body])
        if index < len(source_sections) - 1:
            output.append("")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(output)).strip()


def _filter_contact_to_source(source_resume: str, contact: Dict[str, str]) -> Dict[str, str]:
    header, _ = _parse_resume_structure(source_resume)
    head = " | ".join(header)
    filtered = {"full_name": header[0] if header else ""}
    labels = {"linkedin": r"linkedin", "github": r"github", "portfolio": r"portfolio|website"}
    for key in ("email", "phone", "location"):
        value = (contact.get(key) or "").strip()
        filtered[key] = value if value and value.lower() in head.lower() else ""
    for key, label in labels.items():
        value = (contact.get(key) or "").strip()
        mentioned = value and (value.lower() in head.lower() or re.search(rf"\b(?:{label})\b", head, re.I))
        filtered[key] = value if mentioned else ""
    return filtered


def tailor_resume_content_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 3: Intelligently tailors the user's resume for the target job:
    - Customizes the headline & executive summary for target role & company.
    - Elevates matching technical skills into a highlighted Core Competencies section.
    - Adapts experience bullet points to showcase direct alignment.
    """
    if state.get("status") == "FAILED":
        return state
    logs = list(state.get("logs", []))
    raw = state.get("raw_resume", "").strip()
    job_title = (state.get("job_title") or "Software Engineer").strip()
    company_name = (state.get("company_name") or "the hiring organization").strip()
    keywords = state.get("extracted_keywords", [])
    ats_report = state.get("ats_report") or {}

    matched_skills = []
    missing_skills = []

    for kw in keywords:
        if re.search(r"\b" + re.escape(kw) + r"\b", raw, re.IGNORECASE):
            matched_skills.append(kw)
        else:
            missing_skills.append(kw)

    logs.append(f"Skill Alignment: {len(matched_skills)} verified matches, {len(missing_skills)} gaps retained as recommendations.")

    # 0. Direct User LLM Resume Tailoring if API key is provided
    llm_api_key = (state.get("llm_api_key") or "").strip()
    if llm_api_key:
        try:
            req_details = " ".join([state.get("requirements") or "", state.get("job_description") or ""])
            report_suggestions = ats_report.get("suggestions") or []
            sugg_text = "\n".join([f"- {s.get('detail') if isinstance(s, dict) else str(s)}" for s in report_suggestions[:5]])

            prompt = f"""You are an elite Executive Resume Strategist and ATS Optimization Specialist.
Rewrite and optimize the candidate's existing resume to achieve maximum ATS compatibility and recruiter impact for the target role.

Target Job:
Role: {job_title}
Company: {company_name}
Requirements:
{req_details}

ATS Recommendations:
{sugg_text or "Align technical skills and experience bullets with target responsibilities."}

Original Resume:
\"\"\"{raw}\"\"\"

CRITICAL RULES:
1. Do NOT use ASCII decorative borders or horizontal lines (e.g. NEVER output lines of '═════' or '-----').
2. Copy the complete header/personal-information block EXACTLY from the source: name, existing professional headline, address/location, phone, email, LinkedIn, GitHub, portfolio, and every visible URL.
3. Preserve every original section heading, in the same wording and order.
4. Copy EDUCATION, certifications, projects, job titles, employer names, employment dates, and locations verbatim.
5. You may change ONLY: the professional-summary wording, technical-skill ordering/emphasis, and experience bullet wording. Keep the same experience bullets in the same job, and preserve every number and factual claim.
6. Emphasize verified skills only. Never fabricate skills, metrics, employers, projects, universities, credentials, or hyperlinks.
7. Return ONLY a valid JSON object matching this schema:
{{
  "tailoredResume": "Complete optimized plain text resume",
  "matchedSkills": ["Skill 1", "Skill 2"],
  "missingSkills": ["Gap 1", "Gap 2"],
  "enhancements": ["Action 1 taken", "Action 2 taken", "Action 3 taken"]
}}
"""
            raw_json = call_user_llm(
                prompt=prompt,
                system_prompt="You optimize resumes for maximum ATS indexing. Return pure JSON with zero markdown fluff.",
                provider=state.get("llm_provider", "OpenAI"),
                api_key=llm_api_key,
                model=state.get("llm_model", ""),
                temperature=0.2,
                json_mode=True,
            )
            parsed = parse_json_from_llm_response(raw_json)
            if parsed.get("tailoredResume") and len(parsed["tailoredResume"]) > 200:
                cleaned_resume = enforce_resume_fidelity(raw, parsed["tailoredResume"].replace("═", "").strip())
                logs.append(f"Successfully optimized resume via user's LLM ({state.get('llm_provider', 'OpenAI')})")
                return {
                    **state,
                    "tailored_resume": cleaned_resume,
                    "matched_skills": parsed.get("matchedSkills") or matched_skills,
                    "missing_skills": parsed.get("missingSkills") or missing_skills,
                    "enhancements": parsed.get("enhancements") or [
                        f"Targeted headline and professional summary for {job_title} at {company_name}.",
                        "Optimized technical competencies and ATS keywords.",
                        "Standardized clean formatting without non-standard symbols.",
                    ],
                    "status": "TAILORED",
                    "logs": logs,
                }
        except Exception as e:
            logs.append(f"User LLM resume optimization notice: {str(e)}. Falling back to template tailor engine.")

    # Emphasize verified skills only. Missing keywords become recommendations, never fabricated claims.
    report_matched = ats_report.get("matchedSkills") or ats_report.get("matched_skills") or []
    verified_matches = []
    for skill in matched_skills + report_matched:
        if skill not in verified_matches and re.search(r"\b" + re.escape(skill) + r"\b", raw, re.IGNORECASE):
            verified_matches.append(skill)
    top_skills_to_highlight = verified_matches[:12]
    skills_formatted = ", ".join(top_skills_to_highlight) if top_skills_to_highlight else "Software Engineering, Problem Solving, Collaboration"

    # Break raw resume into sections
    lines = raw.split("\n")
    name_line = lines[0].strip() if len(lines) > 0 and lines[0].strip() else "CANDIDATE"
    original_headline = ""
    if len(lines) > 1:
        second = lines[1].strip()
        if second and not re.search(r"@|phone|\+|https?://|linkedin|github|portfolio", second, re.I) and not re.search(r"^(PROFESSIONAL|SUMMARY|EXPERIENCE|EDUCATION|SKILLS|CORE)", second, re.I):
            original_headline = second
    
    # Check if second line is a contact line or headline
    contact_info = ""
    for line in lines[1:5]:
        if any(c in line for c in ["@", "phone", "+", "http", "linkedin", "github", "location", "|"]):
            contact_info = line.strip()
            break

    profile_contacts = [(state.get(key) or "").strip() for key in ("email", "phone", "location", "linkedin", "github", "portfolio") if (state.get(key) or "").strip()]
    if profile_contacts:
        contact_info = " | ".join(profile_contacts)
    elif not contact_info and len(lines) > 1:
        contact_info = lines[1].strip()

    # Generate tailored summary
    tailored_summary = (
        f"Results-oriented {job_title} with proven proficiency in {skills_formatted}. "
        f"Demonstrated track record of delivering high-quality engineering solutions, optimizing workflows, and adapting rapidly to new technology stacks. "
        f"Excited to bring hands-on expertise, technical agility, and collaborative drive to {company_name}."
    )

    enhancements = [
        f"Aligned professional headline and target role directly with '{job_title}'.",
        f"Customized Executive Summary specifically targeting requirements for {company_name}.",
        f"Elevated and spotlighted key matching competencies: {skills_formatted}.",
        f"Refined ATS formatting for maximum keyword indexing and recruiter readability.",
    ]
    report_suggestions = ats_report.get("suggestions") or []
    for suggestion in report_suggestions[:3]:
        detail = suggestion.get("detail") if isinstance(suggestion, dict) else str(suggestion)
        if detail:
            enhancements.append(f"ATS recommendation applied where supported: {detail}")

    # Reconstruct tailored resume document
    tailored_blocks = [
        f"{name_line.upper()}",
        f"{job_title.upper()} | TARGET ROLE",
        f"{contact_info}" if contact_info else "",
        "",
        "PROFESSIONAL SUMMARY",
        tailored_summary,
        "",
        "CORE COMPETENCIES & TARGET SKILLS",
        f"• Key Technologies & Methodologies: {skills_formatted}",
        "• Focus Areas: System Reliability, Automation Pipelines, Clean Architecture",
    ]

    # Incorporate remaining sections from raw resume (Experience, Projects, Education)
    has_seen_summary = False
    in_experience_section = False
    body_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if body_lines and body_lines[-1] != "":
                body_lines.append("")
            continue

        # Skip original name/contact header lines already generated
        if stripped == name_line or stripped == contact_info or stripped == original_headline:
            continue

        # Detect experience or education
        if re.search(r"^(?:PROFESSIONAL\s+EXPERIENCE|EXPERIENCE|WORK\s+HISTORY|PROJECTS|EDUCATION)", stripped, re.IGNORECASE):
            body_lines.append("")
            body_lines.append(stripped.upper())
            continue

        if re.search(r"^(?:SUMMARY|PROFESSIONAL\s+SUMMARY|ABOUT|PROFILE)", stripped, re.IGNORECASE):
            has_seen_summary = True
            continue

        if has_seen_summary:
            # Skip old summary paragraph until next section
            if re.search(r"^[A-Z\s]{4,}$", stripped) and not stripped.startswith("•"):
                has_seen_summary = False
                body_lines.append("")
                body_lines.append(stripped.upper())
            continue

        # Retain original bullet points and experience details
        body_lines.append(stripped)

    # If section detection was inconclusive, preserve the candidate's original facts.
    if len(body_lines) < 5:
        body_lines = [line.strip() for line in lines[1:] if line.strip() and line.strip() != contact_info]

    tailored_blocks.extend(body_lines)
    full_tailored_resume = enforce_resume_fidelity(raw, "\n".join(tailored_blocks).strip())

    logs.append("Successfully generated tailored resume with targeted keywords.")

    return {
        **state,
        "tailored_resume": full_tailored_resume,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "enhancements": enhancements,
        "status": "TAILORED",
        "logs": logs,
    }


def _safe_url(value: str, scheme: str = "https") -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://", "mailto:", "tel:")):
        return value
    return f"{scheme}://{value}" if scheme == "https" else f"{scheme}:{value}"


def _extract_contact_data(resume_text: str, contact: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    values = {key: (contact or {}).get(key, "").strip() for key in (
        "full_name", "email", "phone", "location", "linkedin", "github", "portfolio"
    )}
    lines = [line.strip() for line in (resume_text or "").splitlines() if line.strip()]
    if lines and not values["full_name"]:
        values["full_name"] = lines[0]
    joined = " | ".join(lines[:6])
    if not values["email"]:
        match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", joined)
        values["email"] = match.group(0) if match else ""
    if not values["phone"]:
        match = re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", joined)
        values["phone"] = match.group(0).strip() if match else ""
    for key, pattern in (
        ("linkedin", r"https?://(?:www\.)?linkedin\.com/[^\s|]+"),
        ("github", r"https?://(?:www\.)?github\.com/[^\s|]+"),
        ("portfolio", r"https?://[^\s|]+"),
    ):
        if not values[key]:
            matches = re.findall(pattern, joined, re.IGNORECASE)
            if key == "portfolio":
                matches = [url for url in matches if "linkedin.com" not in url and "github.com" not in url]
            values[key] = matches[0].rstrip(".,)") if matches else ""
    return values


def generate_pdf_bytes_from_text(resume_text: str, contact: Optional[Dict[str, str]] = None) -> bytes:
    """Build a polished, single-column ATS PDF with real clickable contact links."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, HRFlowable

    buffer = io.BytesIO()
    navy = colors.HexColor("#132238")
    blue = colors.HexColor("#2563EB")
    slate = colors.HexColor("#334155")
    muted = colors.HexColor("#64748B")
    rule = colors.HexColor("#CBD5E1")
    contacts = _extract_contact_data(resume_text, contact)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setTitle(f"{contacts.get('full_name') or 'Candidate'} - Resume")
        canvas.setAuthor(contacts.get("full_name") or "Candidate")
        canvas.setSubject("ATS-optimized professional resume")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(muted)
        canvas.drawRightString(letter[0] - 0.62 * inch, 0.34 * inch, f"Page {doc.page}")
        canvas.restoreState()

    doc = BaseDocTemplate(
        buffer, pagesize=letter, leftMargin=0.62 * inch, rightMargin=0.62 * inch,
        topMargin=0.46 * inch, bottomMargin=0.5 * inch,
        title="Professional Resume", author="JobApply Resume Agent",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="resume", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id="resume", frames=[frame], onPage=footer))
    base = getSampleStyleSheet()
    styles = {
        "name": ParagraphStyle("Name", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=20, leading=23, textColor=navy, alignment=TA_CENTER, spaceAfter=2),
        "title": ParagraphStyle("Title", parent=base["Normal"], fontName="Helvetica", fontSize=10.5, leading=13, textColor=slate, alignment=TA_CENTER, spaceAfter=5),
        "contact": ParagraphStyle("Contact", parent=base["Normal"], fontName="Helvetica", fontSize=8.2, leading=11, textColor=muted, alignment=TA_CENTER, spaceAfter=7),
        "section": ParagraphStyle("Section", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10.2, leading=12, textColor=navy, spaceBefore=4.5, spaceAfter=2, keepWithNext=True),
        "body": ParagraphStyle("Body", parent=base["Normal"], fontName="Helvetica", fontSize=8.4, leading=10.2, textColor=slate, alignment=TA_LEFT, spaceAfter=1.5),
        "bullet": ParagraphStyle("Bullet", parent=base["Normal"], fontName="Helvetica", fontSize=8.4, leading=10.2, textColor=slate, leftIndent=10, firstLineIndent=-7, bulletIndent=0, spaceAfter=1.2),
        "role": ParagraphStyle("Role", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.9, leading=10.5, textColor=navy, spaceBefore=2, spaceAfter=0.5, keepWithNext=True),
        "meta": ParagraphStyle("Meta", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8, leading=9.8, textColor=muted, spaceAfter=1.5, keepWithNext=True),
    }

    lines = [line.strip() for line in (resume_text or "").splitlines()]
    nonempty = [line for line in lines if line]
    name = contacts.get("full_name") or (nonempty[0] if nonempty else "Candidate")
    title = ""
    if len(nonempty) > 1 and not re.search(r"@|\+?\d{7}|linkedin|github|portfolio", nonempty[1], re.I):
        title = re.sub(r"\s*\|\s*TARGET ROLE\s*$", "", nonempty[1], flags=re.I).title()

    story = [Paragraph(html.escape(name.upper()), styles["name"])]
    if title:
        story.append(Paragraph(html.escape(title), styles["title"]))
    contact_parts = []
    for label, key, scheme in (
        ("Email", "email", "mailto"), ("Phone", "phone", "tel"), ("Location", "location", ""),
        ("LinkedIn", "linkedin", "https"), ("GitHub", "github", "https"), ("Portfolio", "portfolio", "https"),
    ):
        value = contacts.get(key, "")
        if not value:
            continue
        shown = value if key in ("email", "phone", "location") else label
        if scheme:
            href = html.escape(_safe_url(value, scheme), quote=True)
            contact_parts.append(f'<link href="{href}" color="#2563EB"><u>{html.escape(shown)}</u></link>')
        else:
            contact_parts.append(html.escape(shown))
    if contact_parts:
        story.append(Paragraph(" &nbsp;|&nbsp; ".join(contact_parts), styles["contact"]))
    story.append(HRFlowable(width="100%", thickness=0.8, color=blue, spaceAfter=4))

    section_re = re.compile(r"^(PROFESSIONAL SUMMARY|SUMMARY|CORE COMPETENCIES(?: & TECHNICAL SKILLS)?|CORE COMPETENCIES & TARGET SKILLS|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|SELECTED AGENTIC AI PROJECTS|PROJECTS(?: & TECHNICAL HIGHLIGHTS)?|EDUCATION(?: & CREDENTIALS)?|CERTIFICATIONS|ACHIEVEMENTS)$", re.I)
    header_skip = {name.upper(), "CANDIDATE CONTACT HEADER"}
    skipped_title = False
    current_section = ""
    for line in lines:
        if not line or line.upper() in header_skip or re.fullmatch(r"(?:LINKEDIN\s*\|\s*)?GITHUB\s*\|\s*PORTFOLIO", line, re.I):
            continue
        normalized_title = re.sub(r"\s*\|\s*TARGET ROLE\s*$", "", line, flags=re.I).title()
        if title and not skipped_title and normalized_title == title:
            skipped_title = True
            continue
        if re.search(r"Email:|Phone:|LinkedIn|GitHub|Portfolio", line, re.I) and ("@" in line or "Phone:" in line):
            continue
        clean = html.escape(line.lstrip("-• ").strip())
        if section_re.match(line):
            current_section = line.upper()
            heading = Paragraph(html.escape(current_section), styles["section"])
            divider = HRFlowable(width="100%", thickness=0.45, color=rule, spaceAfter=3)
            divider.keepWithNext = True
            story.extend([Spacer(1, 2), heading, divider])
        elif line.startswith(("-", "•")):
            story.append(Paragraph(f"<bullet>-</bullet>{clean}", styles["bullet"]))
        elif " | " in line and len(line) < 120 and not line.endswith("."):
            is_meta = bool(re.match(r"^(Contract|Full[- ]time|Part[- ]time|\d{4})\b", line, re.I))
            style = styles["meta"] if is_meta else (styles["body"] if current_section == "CERTIFICATIONS" else styles["role"])
            story.append(Paragraph(clean, style))
        else:
            story.append(Paragraph(clean, styles["body"]))

    doc.build(story)
    return buffer.getvalue()


def persist_resume_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 4: Persists the tailored resume back to Supabase database & storage bucket as an ATS PDF document.
    """
    if state.get("status") == "FAILED":
        return state
    logs = list(state.get("logs", []))
    save_to_db = state.get("save_to_db", True)
    user_id = state.get("user_id", "").strip()
    tailored = state.get("tailored_resume", "").strip()
    job_title = state.get("job_title", "Custom").strip()

    if not save_to_db or not user_id or not tailored:
        logs.append("Skipping database persistence (save_to_db is False or user_id missing).")
        return {**state, "status": "COMPLETED", "logs": logs}

    try:
        supabase = get_supabase_client()
        file_name = _tailored_resume_filename(
            supabase,
            user_id,
            state.get("full_name", ""),
            job_title,
            state.get("raw_resume", ""),
        )

        logs.append(f"Persisting tailored resume '{file_name}' to Supabase for user {user_id}...")

        # Keep the uploaded master resume untouched; record this as a job-specific version.
        try:
            supabase.from_("resumes").insert({
                "user_id": user_id,
                "file_name": file_name,
                "file_path": f"{user_id}/{file_name}",
                "parsed_text": tailored,
                "is_primary": False,
            }).execute()
            logs.append("Recorded tailored resume as a non-primary job-specific version.")
        except Exception as metadata_err:
            logs.append(f"Resume metadata insert notice: {metadata_err}")

        # Upload to Supabase Storage bucket 'resumes/{user_id}/{file_name}' as PDF
        try:
            try:
                contact = {}
                try:
                    profile_result = supabase.from_("users").select(
                        "full_name,email,phone,location,linkedin,github,portfolio"
                    ).eq("id", user_id).maybe_single().execute()
                    contact = (profile_result.data or {}) if profile_result else {}
                except Exception as profile_err:
                    logs.append(f"Profile contact lookup notice: {profile_err}")
                for key in ("full_name", "email", "phone", "location", "linkedin", "github", "portfolio"):
                    if state.get(key):
                        contact[key] = state.get(key)
                contact = _filter_contact_to_source(state.get("raw_resume") or tailored, contact)
                pdf_payload = generate_pdf_bytes_from_text(tailored, contact)
                content_type = "application/pdf"
            except Exception as pdf_gen_err:
                logs.append(f"ReportLab PDF notice ({pdf_gen_err}), saving raw text payload.")
                pdf_payload = tailored.encode("utf-8")
                content_type = "text/plain;charset=utf-8"

            supabase.storage.from_("resumes").upload(
                f"{user_id}/{file_name}",
                pdf_payload,
                {"upsert": "true", "content-type": content_type}
            )
            signed = supabase.storage.from_("resumes").create_signed_url(f"{user_id}/{file_name}", 7200)
            signed_url = (signed or {}).get("signedURL") or (signed or {}).get("signedUrl") or ""
            logs.append(f"Successfully uploaded tailored resume to Supabase storage bucket 'resumes/{user_id}/{file_name}'.")
        except Exception as st_err:
            logs.append(f"Storage bucket upload notice: {st_err}")

        return {
            **state,
            "resume_name": file_name,
            "pdf_file_path": f"{user_id}/{file_name}",
            "pdf_url": signed_url,
            "status": "SAVED",
            "logs": logs,
        }

    except Exception as e:
        logs.append(f"Persistence warning: {str(e)}")
        # Don't fail the whole generation if DB write hits constraint; return tailored content
        return {
            **state,
            "status": "COMPLETED_WITH_DB_WARNING",
            "logs": logs,
        }


# -----------------------------------------------------------------------------
# GRAPH COMPILATION
# -----------------------------------------------------------------------------

def build_resume_tailor_graph():
    graph = StateGraph(ResumeTailorState)

    graph.add_node("load_user_resume", load_user_resume_node)
    graph.add_node("analyze_requirements", analyze_requirements_node)
    graph.add_node("tailor_resume_content", tailor_resume_content_node)
    graph.add_node("persist_resume", persist_resume_node)

    graph.add_edge(START, "load_user_resume")
    graph.add_edge("load_user_resume", "analyze_requirements")
    graph.add_edge("analyze_requirements", "tailor_resume_content")
    graph.add_edge("tailor_resume_content", "persist_resume")
    graph.add_edge("persist_resume", END)

    return graph.compile()


resume_tailor_agent = build_resume_tailor_graph()
